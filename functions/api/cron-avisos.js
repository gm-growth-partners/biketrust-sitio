// Cloudflare Pages Function · GET/POST /api/cron-avisos
//
// EL BARRIDO DE AVISOS AL EQUIPO. Es la RED del sistema de avisos V2.
//
// EL PROBLEMA QUE RESUELVE (autopsia 2026-08-06)
// Hasta hoy «avisarle al equipo» era un EVENTO: ocurría —o no— dentro de
// `mc-llamado`, en el instante en que el bot creaba el ticket. Si en ese momento
// no era horario, si faltaba una env, si ManyChat devolvía error, o si el ticket
// simplemente no venía del bot, el aviso se perdía PARA SIEMPRE y sin rastro.
// Medido en la base real: de 5 tickets vivos, 4 eran `Origen=Manual` y ninguno
// disparó jamás un aviso. Hubo que rescatar 4 leads a mano tras 10 días varados.
//
// LA INVERSIÓN
// «Avisado» deja de ser un evento y pasa a ser un ESTADO, escrito en Airtable:
// el campo `Aviso equipo enviado`. Vacío = nadie del equipo se ha enterado.
// Este barrido corre cada 15 min y hace UNA pregunta: ¿hay tickets sin sello?
//   · Dentro de la franja (9–20)  → avisa y sella.
//   · Fuera de la franja           → no hace nada. Se acumulan solos.
//   · En el tick del briefing      → se hace a un lado: el briefing los lista
//                                    a todos juntos y los sella él.
//
// LO QUE ESTO COMPRA
//   · Los cuatro caminos de entrada quedan cubiertos por el MISMO mecanismo:
//     bot de comentarios, bot de DM, carga manual en Airtable y botón de rescate.
//   · Si el envío falla, no se sella → el próximo tick reintenta solo. Antes, un
//     fallo de ManyChat era un lead perdido en silencio.
//   · «¿Cuántos entraron fuera de horario?» pasa a ser una consulta, no una
//     estimación.
//
// Envs: CRON_KEY (candado) · MANYCHAT_TOKEN · FLOW_NS_LLAMADO / FLOW_NS_SOLICITUD /
// FLOW_NS_CONSIGNA · AVISO_*_SIDS · AVISO_FRANJA (opcional, default 9-20).
// Pruebas: ?dry=1 (arma todo, no manda ni sella) · ?force=1 (ignora franja y briefing).

import {
  enFranja, esTickBriefing, avisarStaff, unaLinea, franja, chileHora,
} from '../../lib/avisos.js';

const JSONH = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSONH });
const BASE_DEFAULT = 'appQUgk8aeD752923';

// Tope por corrida y por cola. Con ticks de 15 min son 40 avisos/hora como
// máximo: suficiente para cualquier ráfaga real y un freno si algo se descontrola.
const MAX_POR_CORRIDA = 10;

// GRACIA DE MADUREZ. Cuando Luis crea una fila con el «+» del Kanban, la fila
// existe VACÍA unos minutos antes de que termine de llenarla. Sin esta gracia
// recibiría un aviso de un ticket en blanco, escrito por él mismo.
// Se mide sobre `record.createdTime` de la API —exacto— y NO sobre `NOW()` de
// Airtable, que viene cacheado con minutos de atraso (lección §5.13 de CLAUDE.md).
const MADUREZ_MIN = 10;

// Tope de reintentos. Si un destinatario está roto de forma permanente, sin este
// freno el barrido reenviaría a los demás cada 15 min para siempre.
const MAX_INTENTOS = 3;

async function afetch(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, opts);
    if (r.status !== 429 || i >= tries - 1) return r;
    await new Promise(res => setTimeout(res, 1200 * (i + 1)));
  }
}

const keyOk = (env, url) => { const need = env.CRON_KEY; return need ? url.searchParams.get('key') === need : true; };
const clp = (n) => (n == null ? '' : '$' + Number(n).toLocaleString('es-CL'));

// ── Las tres colas ───────────────────────────────────────────────────────────
// Cada una: de dónde leer, qué cuenta como «pendiente», a quién avisar y con qué
// plantilla. El resumen se arma con los campos que YA tiene el registro; el único
// dato que exige una lectura extra es el modelo de la bici (link → nombre), y se
// hace sólo para los registros que de verdad se van a mandar.
const COLAS = [
  {
    key: 'llamados',
    tabla: (env) => env.AIRTABLE_LLAMADOS_TABLE || 'Llamados',
    estado: 'Llamada pendiente',
    cual: 'llamado',
    flowEnv: 'FLOW_NS_LLAMADO',
    campo: 'cf_llamado_datos',
    necesitaBici: true,
    resumen: (f, modelo) => [
      f['Nombre'] || 'sin nombre',
      f['Ciudad'] ? `de ${f['Ciudad']}` : '',
      modelo ? `interesado en ${modelo}` : '',
      f['Teléfono'] || 'sin teléfono',
      f['Pidió rellamada'] ? '🔁 pidió que lo llamaran de vuelta' : '',
    ].filter(Boolean).join(' · '),
  },
  {
    key: 'solicitudes',
    tabla: (env) => env.AIRTABLE_SOLICITUDES_TABLE || 'Solicitudes',
    estado: 'Llamada pendiente',
    cual: 'solicitud',
    flowEnv: 'FLOW_NS_SOLICITUD',
    campo: 'cf_solicitud_datos',
    necesitaBici: false,
    // Formato unificado (2026-08-06): el modelo primero y el resto entre
    // paréntesis, para que la frase de la plantilla —«Nueva solicitud de búsqueda
    // recibida {{1}}, cambia el estado…»— se lea bien con la variable a mitad de
    // oración. Antes cada emisor mandaba un orden distinto.
    resumen: (f) => {
      const extra = [
        f['Talla'] ? `talla ${f['Talla']}` : '',
        f['Presupuesto'] != null ? `hasta ${clp(f['Presupuesto'])}` : '',
        f['Contacto'] || 'sin teléfono',
      ].filter(Boolean).join(' · ');
      return `${f['Modelo buscado'] || 'modelo por confirmar'}${extra ? ` (${extra})` : ''}`;
    },
  },
  {
    key: 'consignaciones',
    tabla: (env) => env.AIRTABLE_CONSIGNACIONES_TABLE || 'Consignaciones',
    estado: 'Nueva',
    cual: 'consigna',
    flowEnv: 'FLOW_NS_CONSIGNA',
    campo: 'cf_consigna_datos',
    necesitaBici: false,
    resumen: (f) => {
      const extra = [
        f['Año'] ? `${f['Año']}` : '',
        f['Talla'] ? `talla ${f['Talla']}` : '',
        f['Precio esperado'] != null ? `pide ${clp(f['Precio esperado'])}` : '',
        f['Contacto'] || 'sin teléfono',
      ].filter(Boolean).join(' · ');
      return `${f['Modelo'] || 'bici sin modelo'}${extra ? ` (${extra})` : ''}`;
    },
  },
];

async function barrerCola(env, C, cola, { dry }) {
  const tabla = cola.tabla(env);
  const api = (t) => `https://api.airtable.com/v0/${C.BASE}/${encodeURIComponent(t)}`;

  // Sin sello + no agotado + en el estado que significa «alguien tiene que actuar».
  const formula = `AND({Estado}='${cola.estado}', {Aviso equipo enviado}=BLANK(), OR({Intentos aviso}=BLANK(), {Intentos aviso}<${MAX_INTENTOS}))`;
  const url = `${api(tabla)}?pageSize=50&filterByFormula=${encodeURIComponent(formula)}`;

  const rr = await afetch(url, { headers: C.rH });
  if (!rr.ok) return { cola: cola.key, error: 'airtable_read', status: rr.status, detalle: (await rr.text()).slice(0, 200) };

  const todos = (await rr.json()).records || [];

  // Gracia de madurez, en JS y contra el createdTime real de la API.
  const corte = Date.now() - MADUREZ_MIN * 60000;
  const maduros = todos.filter(r => new Date(r.createdTime).getTime() <= corte);
  const verdes = todos.length - maduros.length;

  // Más viejo primero: el que lleva más esperando es el que más se enfría.
  maduros.sort((a, b) => String(a.createdTime).localeCompare(String(b.createdTime)));
  const lote = maduros.slice(0, MAX_POR_CORRIDA);
  const encolados = maduros.length - lote.length;

  const detalle = [];
  for (const rec of lote) {
    const f = rec.fields || {};

    // El modelo exige leer la bici enlazada (el link trae ids, no nombres).
    let modelo = '';
    if (cola.necesitaBici) {
      const link = f['Bici de interés'];
      const biciId = (Array.isArray(link) ? link[0] : link) || '';
      const id = typeof biciId === 'string' ? biciId : biciId?.id;
      if (id) {
        const br = await afetch(`${api('Inventario')}/${id}`, { headers: C.rH });
        if (br.ok) { const bf = (await br.json()).fields || {}; modelo = bf.Modelo || bf.Etiqueta || ''; }
      }
    }

    const texto = unaLinea(cola.resumen(f, modelo));

    if (dry) { detalle.push({ id: rec.id, texto, accion: 'dry' }); continue; }

    const res = await avisarStaff(env, {
      cual: cola.cual, flowEnv: cola.flowEnv, campo: cola.campo, texto,
    });

    // LA REGLA DEL SELLO: se sella si AL MENOS UNO se enteró. Si nadie se enteró,
    // no se sella —para que el próximo tick reintente— y se cuenta el intento.
    if (res.enviados > 0) {
      await afetch(`${api(tabla)}/${rec.id}`, {
        method: 'PATCH', headers: C.wH,
        body: JSON.stringify({ typecast: true, fields: { 'Aviso equipo enviado': new Date().toISOString() } }),
      });
      detalle.push({ id: rec.id, texto, accion: 'avisado', enviados: res.enviados, errores: res.errores });
    } else {
      const intentos = Number(f['Intentos aviso'] || 0) + 1;
      await afetch(`${api(tabla)}/${rec.id}`, {
        method: 'PATCH', headers: C.wH,
        body: JSON.stringify({ typecast: true, fields: { 'Intentos aviso': intentos } }),
      });
      detalle.push({ id: rec.id, texto, accion: 'falló', intentos, motivo: res.motivo, errores: res.errores, falta: res.falta });

      // Al agotar los intentos, escala UNA vez por el canal de «humano requerido»,
      // que tiene su propia cadena de destinatarios y no respeta horario. Si esto
      // también falla, queda visible en Airtable: `Intentos aviso` = 3 con el
      // sello vacío es exactamente «nadie se enteró y ya nos rendimos».
      if (intentos >= MAX_INTENTOS) {
        await avisarStaff(env, {
          cual: 'equipo', flowEnv: 'FLOW_NS_AVISO_EQUIPO', campo: 'cf_aviso_datos',
          texto: `⚠️ No se pudo avisar de un ticket en ${tabla} tras ${MAX_INTENTOS} intentos: ${texto}. Revísalo a mano en Airtable.`,
        });
      }
    }
  }

  return {
    cola: cola.key,
    pendientes: todos.length,
    verdes,        // aún dentro de la gracia de madurez
    procesados: lote.length,
    encolados,     // quedaron para el próximo tick por el tope
    detalle,
  };
}

async function run(env, url) {
  const BASE = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  const WRITE = env.AIRTABLE_WRITE_TOKEN;
  if (!READ || !WRITE) return reply({ error: 'not_configured (airtable)' }, 503);

  const dry = url.searchParams.get('dry') === '1';
  const force = url.searchParams.get('force') === '1';
  const now = new Date();
  const { desde, hasta } = franja(env);

  // GUARDA 1 · El tick del briefing. El briefing lista TODO lo acumulado y lo
  // sella él; si el barrido corriera en el mismo tick, mandaría además un aviso
  // individual por cada uno. Esta guarda NO depende del orden en que el worker
  // llame a los endpoints —a propósito: ese orden es fácil de romper al editar
  // el array y nadie se daría cuenta.
  if (!force && esTickBriefing(env, now)) {
    return reply({ ok: true, saltado: 'tick_del_briefing', hora: chileHora(now) });
  }

  // GUARDA 2 · La franja. Fuera de 9–20 no se molesta a nadie; los tickets se
  // acumulan sin sello y el briefing de la mañana los recoge. Ésa es la red que
  // hace que silenciar de noche no sea perder.
  if (!force && !enFranja(env, now)) {
    return reply({ ok: true, saltado: 'fuera_de_franja', hora: chileHora(now), franja: `${desde}-${hasta}` });
  }

  const C = {
    BASE,
    rH: { Authorization: `Bearer ${READ}` },
    wH: { Authorization: `Bearer ${WRITE}`, 'Content-Type': 'application/json' },
  };

  const colas = [];
  for (const cola of COLAS) colas.push(await barrerCola(env, C, cola, { dry }));

  const avisados = colas.reduce((n, c) => n + (c.detalle || []).filter(d => d.accion === 'avisado').length, 0);
  const fallidos = colas.reduce((n, c) => n + (c.detalle || []).filter(d => d.accion === 'falló').length, 0);

  return reply({ ok: true, dry, force, hora: chileHora(now), franja: `${desde}-${hasta}`, avisados, fallidos, colas });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return reply({ error: 'unauthorized' }, 401);
  return run(env, url);
}
export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return reply({ error: 'unauthorized' }, 401);
  return run(env, url);
}
