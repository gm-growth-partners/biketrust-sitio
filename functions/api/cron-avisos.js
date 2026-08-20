// Cloudflare Pages Function · GET/POST /api/cron-avisos
//
// EL BARRIDO DE AVISOS AL EQUIPO. Es la RED del sistema de avisos.
//
// EL PROBLEMA QUE RESUELVE (autopsia 2026-08-06)
// Hasta entonces «avisarle al equipo» era un EVENTO: ocurría —o no— dentro de
// `mc-llamado`, en el instante en que el bot creaba el ticket. Si en ese momento
// no era horario, si faltaba una env, si ManyChat devolvía error, o si el ticket
// simplemente no venía del bot, el aviso se perdía PARA SIEMPRE y sin rastro.
// Medido en la base real: de 5 tickets vivos, 4 eran `Origen=Manual` y ninguno
// disparó jamás un aviso. Hubo que rescatar 4 leads a mano tras 10 días varados.
//
// LA INVERSIÓN
// «Avisado» dejó de ser un evento y pasó a ser un ESTADO, escrito en Airtable:
// el campo `Aviso equipo enviado`. Vacío = nadie del equipo se ha enterado.
// Este barrido corre cada 15 min y hace UNA pregunta: ¿hay registros sin sello?
//   · Con alguien en su turno   → avisa y sella.
//   · Sin nadie en turno         → no hace nada. Se acumulan solos.
//   · En el tick del briefing    → se hace a un lado: el briefing los lista a
//                                  todos juntos y los sella él.
//
// ── QUÉ CAMBIÓ EL 2026-08-19 ────────────────────────────────────────────────
//
// 1. UNA CUARTA COLA: `Avisos`. Los «el bot no entendió, se necesita a una
//    persona» se registraban en esa tabla y NO LOS BARRÍA NADIE. Si el envío
//    fallaba, o si nadie miraba el teléfono a esa hora, la conversación quedaba
//    varada sin que ningún mecanismo la recuperara. Ahora es una cola como las
//    otras tres, con el mismo sello y el mismo reintento.
//
// 2. LA COLA DE LLAMADOS SE LEE POR `Salida`, NO POR `Estado`. `Salida` es el
//    único campo que toca Luis (arrastra la tarjeta del Kanban); `Estado` es un
//    espejo que mantiene el código. Se desincronizaron en producción y un ticket
//    marcado «Sin interés» siguió contando como pendiente durante 13 días. La
//    regla nueva: la cola la define el campo del OPERADOR, no el derivado.
//
// 3. HORARIO POR PERSONA. Antes había una franja 9–20 pareja para todos. Ahora
//    cada persona declara su turno y sus tipos de aviso en la tabla `Equipo`
//    (ver lib/avisos.js). Sin esa tabla, todo se comporta como antes.
//
// Envs: CRON_KEY (candado) · MANYCHAT_TOKEN · FLOW_NS_LLAMADO / FLOW_NS_SOLICITUD /
// FLOW_NS_CONSIGNA / FLOW_NS_AVISO_EQUIPO · AVISO_*_SIDS · AVISO_FRANJA (default 9-20).
// Pruebas: ?dry=1 (arma todo, no manda ni sella) · ?force=1 (ignora turnos y briefing).

import {
  esTickBriefing, avisar, destinatarios, unaLinea, franja, chileHora,
  COLA_LLAMADOS, COLA_AVISOS,
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

// El pedazo de fórmula que comparten las cuatro colas: sin sello y sin haber
// agotado los reintentos.
const SIN_SELLO = `{Aviso equipo enviado}=BLANK(), OR({Intentos aviso}=BLANK(), {Intentos aviso}<${MAX_INTENTOS})`;

// ── Las cuatro colas ─────────────────────────────────────────────────────────
// Cada una: de dónde leer, qué cuenta como «pendiente», a quién avisar y con qué
// plantilla. El resumen se arma con los campos que YA tiene el registro; el único
// dato que exige una lectura extra es el modelo de la bici (link → nombre), y se
// hace sólo para los registros que de verdad se van a mandar.
const COLAS = [
  {
    key: 'llamados',
    tabla: (env) => env.AIRTABLE_LLAMADOS_TABLE || 'Llamados',
    // 🔴 POR `Salida`, no por `Estado`. La definición vive en lib/avisos.js.
    formula: `AND(${COLA_LLAMADOS}, ${SIN_SELLO})`,
    tipo: 'llamada',
    flowEnv: 'FLOW_NS_LLAMADO',
    campo: 'cf_llamado_datos',
    necesitaBici: true,
    resumen: (f, modelo) => [
      '📞 LLAMAR',
      f['Nombre'] || 'sin nombre',
      f['Teléfono'] || 'SIN TELÉFONO',
      f['Canal'] ? `por ${f['Canal']}` : '',
      f['Ciudad'] ? `de ${f['Ciudad']}` : '',
      modelo ? `interesado en ${modelo}` : '',
      f['Pidió rellamada'] ? '🔁 pidió que lo llamaran de vuelta' : '',
    ].filter(Boolean).join(' · '),
  },
  {
    key: 'avisos',
    tabla: (env) => env.AIRTABLE_AVISOS_TABLE || 'Avisos',
    // La cola nueva: conversaciones que el bot no pudo resolver y que siguen sin
    // respuesta humana. La cierra el arrastre en el Kanban «6 · Falta responder».
    formula: `AND(${COLA_AVISOS}, ${SIN_SELLO})`,
    tipo: 'humano',
    flowEnv: 'FLOW_NS_AVISO_EQUIPO',
    campo: 'cf_aviso_datos',
    necesitaBici: false,
    // `Resumen` ya viene armado por `aviso-humano` con canal, mensaje y contexto.
    resumen: (f) => f['Resumen'] || `${f['@handle IG'] ? `IG @${f['@handle IG']}` : 'un contacto'} necesita respuesta`,
    // ⚠️ Esta cola NO escala vía `avisarHumano` al agotar intentos: crearía otro
    // registro en la misma tabla, que volvería a fallar, que volvería a escalar.
    sinEscalamiento: true,
  },
  {
    key: 'solicitudes',
    tabla: (env) => env.AIRTABLE_SOLICITUDES_TABLE || 'Solicitudes',
    formula: `AND({Estado}='Llamada pendiente', ${SIN_SELLO})`,
    tipo: 'solicitud',
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
    formula: `AND({Estado}='Nueva', ${SIN_SELLO})`,
    tipo: 'consigna',
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

async function barrerCola(env, C, cola, { dry, now }) {
  const tabla = cola.tabla(env);
  const api = (t) => `https://api.airtable.com/v0/${C.BASE}/${encodeURIComponent(t)}`;
  const url = `${api(tabla)}?pageSize=50&filterByFormula=${encodeURIComponent(cola.formula)}`;

  const rr = await afetch(url, { headers: C.rH });
  if (!rr.ok) return { cola: cola.key, error: 'airtable_read', status: rr.status, detalle: (await rr.text()).slice(0, 200) };

  const todos = (await rr.json()).records || [];

  // Gracia de madurez, en JS y contra el createdTime real de la API.
  const corte = now.getTime() - MADUREZ_MIN * 60000;
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

    const res = await avisar(env, {
      tipo: cola.tipo, flowEnv: cola.flowEnv, campo: cola.campo, texto, now,
    });

    // LA REGLA DEL SELLO: se sella si AL MENOS UNO se enteró. Si nadie se enteró,
    // no se sella —para que el próximo tick reintente— y se cuenta el intento.
    if (res.enviados > 0) {
      const sr = await afetch(`${api(tabla)}/${rec.id}`, {
        method: 'PATCH', headers: C.wH,
        body: JSON.stringify({ typecast: true, fields: { 'Aviso equipo enviado': now.toISOString() } }),
      });
      if (sr.ok) {
        detalle.push({ id: rec.id, texto, accion: 'avisado', enviados: res.enviados, errores: res.errores });
        continue;
      }
      // 🔴 EL AVISO SALIÓ PERO EL SELLO NO SE ESCRIBIÓ. Antes este PATCH no se
      // miraba: si Airtable rechazaba la escritura (permisos, campo renombrado,
      // 422), el registro seguía sin sello y el barrido lo mandaba OTRA VEZ en 15
      // minutos, y otra, para siempre. Se gasta un intento a propósito, para que
      // el freno de 3 lo detenga y quede visible en la tabla.
      const fallidos = Number(f['Intentos aviso'] || 0) + 1;
      await afetch(`${api(tabla)}/${rec.id}`, {
        method: 'PATCH', headers: C.wH,
        body: JSON.stringify({ typecast: true, fields: { 'Intentos aviso': fallidos } }),
      });
      detalle.push({ id: rec.id, texto, accion: 'avisado_sin_sello', intentos: fallidos, status: sr.status });
      continue;
    }

    // ⚠️ «Fuera de horario» NO gasta un intento. Los intentos son para FALLOS
    // (ManyChat caído, sid roto, env faltante); que no haya nadie en turno es el
    // funcionamiento normal del sistema. Contarlo como intento agotaría los 3 en
    // 45 minutos de madrugada y el registro llegaría a la mañana ya «rendido».
    if (res.motivo === 'fuera_de_horario') {
      detalle.push({ id: rec.id, texto, accion: 'nadie_en_turno', fuera: res.destinatarios?.fuera || [] });
      continue;
    }

    const intentos = Number(f['Intentos aviso'] || 0) + 1;
    await afetch(`${api(tabla)}/${rec.id}`, {
      method: 'PATCH', headers: C.wH,
      body: JSON.stringify({ typecast: true, fields: { 'Intentos aviso': intentos } }),
    });
    detalle.push({ id: rec.id, texto, accion: 'falló', intentos, motivo: res.motivo, errores: res.errores, falta: res.falta });

    // Al agotar los intentos, escala UNA vez por el canal de «humano requerido»,
    // que tiene su propia cadena de destinatarios. Si esto también falla, queda
    // visible en Airtable: `Intentos aviso` = 3 con el sello vacío es exactamente
    // «nadie se enteró y ya nos rendimos», y el briefing lo lista igual.
    if (intentos >= MAX_INTENTOS && !cola.sinEscalamiento) {
      await avisar(env, {
        tipo: 'humano', flowEnv: 'FLOW_NS_AVISO_EQUIPO', campo: 'cf_aviso_datos', now,
        texto: `⚠️ No se pudo avisar de un registro en ${tabla} tras ${MAX_INTENTOS} intentos: ${texto}. Revísalo a mano en Airtable.`,
      });
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

  // GUARDA 2 · ¿Hay alguien en turno para ALGO? Reemplaza a la franja global
  // 9–20: con horarios por persona, «es horario» ya no es una sola pregunta.
  // Cuesta una lectura de la tabla `Equipo` (con caché de 60 s) y evita barrer
  // cuatro tablas a las 4 de la mañana para no mandar nada.
  //
  // Sin tabla `Equipo`, `destinatarios` cae a las envs + la franja global, así
  // que el comportamiento es exactamente el de antes.
  const turnos = {};
  for (const cola of COLAS) {
    const d = await destinatarios(env, cola.tipo, now);
    turnos[cola.key] = { enTurno: d.sids.length, fuera: d.fuera.length, fuente: d.fuente };
  }
  if (!force && !Object.values(turnos).some(t => t.enTurno > 0)) {
    return reply({ ok: true, saltado: 'nadie_en_turno', hora: chileHora(now), franja: `${desde}-${hasta}`, turnos });
  }

  const C = {
    BASE,
    rH: { Authorization: `Bearer ${READ}` },
    wH: { Authorization: `Bearer ${WRITE}`, 'Content-Type': 'application/json' },
  };

  const colas = [];
  for (const cola of COLAS) {
    // Si nadie recibe este tipo ahora, ni se lee la tabla: sus registros quedan
    // con el sello vacío y los recoge el briefing (o el próximo turno).
    if (!force && !turnos[cola.key].enTurno) { colas.push({ cola: cola.key, saltado: 'nadie_en_turno' }); continue; }
    colas.push(await barrerCola(env, C, cola, { dry, now }));
  }

  const cuenta = (accion) => colas.reduce((n, c) => n + (c.detalle || []).filter(d => d.accion === accion).length, 0);

  return reply({
    ok: true, dry, force, hora: chileHora(now), franja: `${desde}-${hasta}`, turnos,
    avisados: cuenta('avisado'), fallidos: cuenta('falló'), sinTurno: cuenta('nadie_en_turno'), colas,
  });
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
