// Cloudflare Pages Function · GET/POST /api/cron-briefing
//
// EL BRIEFING DE LA MAÑANA. Sale a las 9:00 hora de Chile (env `BRIEFING_HOUR`),
// TODOS los días, a quien esté suscrito a «Briefing» en la tabla `Equipo` (o, sin
// esa tabla, a `BRIEFING_SIDS`).
//
// SU PAPEL EN EL SISTEMA: es LA RED de la franja horaria. Todo lo que entra
// cuando no hay nadie en turno no dispara aviso individual: se acumula con el
// sello `Aviso equipo enviado` vacío, y este barrido lo lista y lo sella.
//
// Y lista TODA la cola pendiente, no sólo lo nuevo. Es a propósito: si un aviso
// individual salió un día que nadie estaba mirando, el registro igual reaparece
// acá mañana. Ningún caso puede caerse por el hueco entre «ya se avisó» y
// «alguien lo leyó».
//
// ═══════════════════════════════════════════════════════════════════════════
// LO QUE CAMBIÓ EL 2026-08-19 — y por qué
// ═══════════════════════════════════════════════════════════════════════════
//
// 🔴 EL BUG QUE LO MOTIVÓ. El briefing armaba su cola con `{Estado}='Llamada
// pendiente'`. Pero `Estado` no es el campo que toca Luis: Luis arrastra la
// tarjeta, y eso escribe `Salida`. `Estado` es un espejo que mantiene
// `salida-llamado`… y que tenía dos caminos por los que NO se escribía:
//   · un ticket sin Lead enlazado (los que Luis crea a mano con el «+»)
//     → `salida-llamado` devolvía `sin_lead` ANTES de tocar el Estado;
//   · un ticket que ya había mandado un mensaje al cliente
//     → devolvía `ya_enviado`, también antes de tocar el Estado.
// Resultado medido en producción: el ticket de Rodrigo Riquelme quedó con
// `Salida='Sin interés'` y `Estado='Llamada pendiente'`, y el briefing se lo
// repitió a Luis TRECE DÍAS SEGUIDOS, ya marcado como sin interés.
//
// La corrección tiene dos mitades y las dos importan:
//   1. `salida-llamado` sincroniza el espejo ANTES de cualquier return temprano.
//   2. Acá, la cola se lee por **`Salida`** — el campo del operador — y no por el
//      derivado. Aunque el espejo se vuelva a romper, el briefing no miente.
//
// 🆕 CINCO SECCIONES, NO DOS. Antes el briefing sólo sabía de llamados y visitas.
// Las solicitudes de búsqueda, las consignaciones y las conversaciones que el bot
// derivó a un humano se acumulaban sin que NINGÚN briefing las nombrara: si el
// bot no entendía un mensaje a las 23:00, a la mañana siguiente no se enteraba
// nadie. Pedido de Gabriel: «en caso de que cualquier tipo de solicitud de avisos
// se genere en un horario fuera del horario de los miembros del equipo, el
// detalle de lo que pasó y de la acción pendiente del equipo debe ser enviado en
// el brief de las mañanas».
//
// El título de cada sección ES la acción pendiente: POR LLAMAR · SIN RESPONDER ·
// POR BUSCAR · POR EVALUAR. Nadie tiene que deducir qué hacer con cada línea.
//
// 🔒 SELLA LAS CUATRO COLAS, no sólo los llamados. Antes sellaba únicamente los
// tickets de `Llamados`; si hubiese listado una solicitud sin sellarla, el
// barrido de las 09:15 habría mandado además su aviso individual. Ahora lo que
// entra al mensaje se sella, y lo que no cupo se queda sin sellar a propósito
// para que el barrido lo mande. Ni silencio ni duplicado.
//
// QUÉ MANDA — dos variables, no una:
//   {{1}} `cf_llamados_hoy` → todo lo que espera acción, en orden de urgencia.
//   {{2}} `cf_agenda_hoy`   → las visitas agendadas para hoy.
// Se usan DOS porque una variable de plantilla no admite saltos de línea: con una
// sola, todo el briefing quedaba apelmazado en un párrafo.
//
// Env: AIRTABLE_TOKEN · MANYCHAT_TOKEN · FLOW_NS_BRIEFING · BRIEFING_SIDS ·
// BRIEFING_HOUR (default 9) · BRIEFING_DIAS (default todos) · BRIEFING_V2 ·
// AVISOS_VENTANA_DIAS (default 7).
// Protegido por CRON_KEY. Pruebas: ?dry=1 (arma y no manda) · ?force=1 (ignora la hora).

import {
  avisar, unaLinea, hoyHayBriefing, briefingHora, chileHora, chileMin, chileFecha,
  COLA_LLAMADOS, COLA_AVISOS,
} from '../../lib/avisos.js';

const JSONH = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSONH });
const BASE_DEFAULT = 'appQUgk8aeD752923';

// Tope por variable de plantilla. Cada sección se arma ítem por ítem y se corta
// en el último que cabe entero, para no mandar una línea partida a la mitad.
const MAX_VAR = 880;

// Una conversación sin responder deja de listarse pasada esta ventana. Sin esto,
// un aviso que nadie marcó `Resuelto` se quedaría en el briefing para siempre y
// el equipo aprendería a ignorar la sección — que es como muere un tablero.
const VENTANA_DIAS = 7;

async function afetch(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, opts);
    if (r.status !== 429 || i >= tries - 1) return r;
    await new Promise(res => setTimeout(res, 1200 * (i + 1)));
  }
}

const keyOk = (env, url) => { const need = env.CRON_KEY; return need ? url.searchParams.get('key') === need : true; };
const linkIds = (v) => (Array.isArray(v) ? v : []).map(x => (typeof x === 'string' ? x : x.id)).filter(Boolean);
const chileHHMM = (iso) => new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const clp = (n) => (n == null ? '' : '$' + Number(n).toLocaleString('es-CL'));

const cfg = (env) => {
  const BASE = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  return {
    BASE, READ, WRITE: env.AIRTABLE_WRITE_TOKEN,
    LEADS: env.AIRTABLE_LEADS_TABLE || 'Leads',
    INTER: env.AIRTABLE_INTERESES_TABLE || 'Intereses',
    LLAM: env.AIRTABLE_LLAMADOS_TABLE || 'Llamados',
    SOLI: env.AIRTABLE_SOLICITUDES_TABLE || 'Solicitudes',
    CONS: env.AIRTABLE_CONSIGNACIONES_TABLE || 'Consignaciones',
    AVIS: env.AIRTABLE_AVISOS_TABLE || 'Avisos',
    api: (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`,
    rH: { Authorization: `Bearer ${READ}` },
    wH: { Authorization: `Bearer ${env.AIRTABLE_WRITE_TOKEN}`, 'Content-Type': 'application/json' },
  };
};

// Lee TODAS las páginas. La versión anterior pedía `pageSize=25` y contaba
// `recs.length`: con 30 pendientes el encabezado decía «25 pendientes» — o sea que
// el número mentía HACIA ABAJO justo cuando el atraso crecía, que es cuando más
// importa que no mienta.
async function leerTodo(C, tabla, formula, errores = []) {
  const out = [];
  let offset = '';
  for (let i = 0; i < 10; i++) {
    const u = `${C.api(tabla)}?pageSize=100${formula ? `&filterByFormula=${encodeURIComponent(formula)}` : ''}${offset ? `&offset=${offset}` : ''}`;
    const r = await afetch(u, { headers: C.rH });
    // 🔴 UN FALLO DE LECTURA NO PUEDE PARECERSE A «NO HAY NADA PENDIENTE».
    // Antes esto hacía `break` y devolvía la lista vacía: con el token vencido o
    // una tabla renombrada, el briefing habría dicho «nada pendiente 🌱» todas
    // las mañanas —en verde, con `ok: true`— mientras la cola se llenaba.
    if (!r.ok) { errores.push({ tabla, status: r.status }); break; }
    const j = await r.json();
    out.push(...(j.records || []));
    if (!j.offset) break;
    offset = j.offset;
  }
  return out;
}

// Modelo de la bici del lead: cache `MC bici` o fallback vía Intereses.
async function biciDe(C, f) {
  const cache = String(f['MC bici'] || '').trim();
  if (cache) return cache;
  const ids = linkIds(f.Intereses);
  const conBici = [];
  for (const id of ids) {
    const ir = await afetch(`${C.api(C.INTER)}/${id}`, { headers: C.rH });
    if (!ir.ok) continue;
    const inf = (await ir.json()).fields || {};
    const b = linkIds(inf.Bici)[0];
    if (b) conBici.push({ b, agendo: inf.Resultado === 'Agendó' });
  }
  const biciId = (conBici.find(x => x.agendo) || conBici[conBici.length - 1] || {}).b || '';
  if (!biciId) return '';
  const br = await afetch(`${C.api('Inventario')}/${biciId}`, { headers: C.rH });
  if (!br.ok) return '';
  const bf = (await br.json()).fields || {};
  return bf.Modelo || bf.Etiqueta || '';
}

// DESDE CUÁNDO espera este registro. No siempre es su fecha de creación: un
// ticket que volvió a la cola porque la persona apretó «Sí, llámenme» lleva
// esperando desde ESE momento, no desde que nació hace dos semanas. Decirle a
// Luis «esperando 14d» de algo que se reencoló anteayer le enseña a desconfiar
// del número, y un número del que se desconfía no sirve para priorizar.
const desdeCuando = (r) => {
  const t = [r.createdTime, r.fields?.['Pidió rellamada']]
    .filter(Boolean).map(x => new Date(x).getTime()).filter(n => Number.isFinite(n));
  return t.length ? Math.max(...t) : Date.now();
};

const espera = (ms, ahora) => {
  const h = Math.round((ahora - ms) / 3600000);
  return h >= 24 ? `${Math.round(h / 24)}d` : `${h}h`;
};

// Más viejo primero: el que lleva más esperando es el que más se enfría. Y dentro
// de eso, primero los que NADIE ha visto todavía (sello vacío).
const ordenar = (recs) => {
  const nuevo = (r) => (r.fields?.['Aviso equipo enviado'] ? 1 : 0);
  return [...recs].sort((a, b) => (nuevo(a) - nuevo(b)) || (desdeCuando(a) - desdeCuando(b)));
};

// Arma una sección respetando el presupuesto y devuelve QUÉ ítems entraron de
// verdad. Esa lista es la que se sella: si un registro no cupo, no se sella y el
// barrido de las 09:15 lo manda como aviso individual. Ni silencio ni duplicado.
function armar(items, presupuesto) {
  const dentro = [];
  let txt = '';
  for (const it of items) {
    const pieza = (txt ? '   ' : '') + it.linea;
    if (txt.length + pieza.length > presupuesto) break;
    txt += pieza;
    dentro.push(it);
  }
  return { texto: txt, dentro, faltan: items.length - dentro.length };
}

async function run(env, url) {
  const C = cfg(env);
  if (!C.READ) return reply({ error: 'not_configured (airtable)' }, 503);
  const dry = url.searchParams.get('dry') === '1';
  const force = url.searchParams.get('force') === '1';
  const now = new Date();
  const ahora = now.getTime();

  // Gate de hora y de día. `hoyHayBriefing` devuelve true los 7 días salvo que se
  // acote con `BRIEFING_DIAS`: se decidió que salga todos los días (2026-08-06)
  // porque un día sin briefing es un día en que nadie se entera de lo que entró
  // de noche.
  if (!force) {
    if (!hoyHayBriefing(env, now)) {
      return reply({ ok: true, saltado: 'hoy_no_hay_briefing', dia: chileFecha(now) });
    }
    if (!(chileHora(now) === briefingHora(env) && chileMin(now) < 15)) {
      return reply({ ok: true, saltado: 'no_es_la_hora', hora: chileHora(now), min: chileMin(now) });
    }
  }

  const hoy = chileFecha(now);

  // ── 1 · VISITAS DE HOY ─────────────────────────────────────────────────────
  const fVisitas =
    `AND({Fecha visita}, ` +
    `DATETIME_FORMAT(SET_TIMEZONE({Fecha visita}, 'America/Santiago'), 'YYYY-MM-DD')='${hoy}', ` +
    `OR({Estado}='visita_agendada', {Estado}='visita_confirmada'))`;
  const recVisitas = await leerTodo(C, C.LEADS, fVisitas);
  recVisitas.sort((a, b) => String(a.fields['Fecha visita']).localeCompare(String(b.fields['Fecha visita'])));

  const itemsVisitas = [];
  for (let i = 0; i < recVisitas.length; i++) {
    const f = recVisitas[i].fields;
    const nombre = f['Nombre'] || (f['@handle IG'] ? `@${f['@handle IG']}` : 'Sin nombre');
    const bici = (await biciDe(C, f)) || 'bici por confirmar';
    itemsVisitas.push({
      id: recVisitas[i].id,
      linea: `(${i + 1}) ${chileHHMM(f['Fecha visita'])} · ${nombre} · ${bici} · ${f['WhatsApp'] || 's/tel'}`,
    });
  }
  const visitas = armar(itemsVisitas, MAX_VAR);
  const txtVisitas = visitas.texto
    ? visitas.texto + (visitas.faltan ? `   (+${visitas.faltan} más)` : '')
    : 'sin visitas hoy 🌱';

  // ── 2 · LAS CUATRO COLAS QUE ESPERAN ACCIÓN ────────────────────────────────
  //
  // 🔴 Las dos colas con Kanban se leen por el campo que arrastra la PERSONA
  // (`Salida`), nunca por un derivado. Las definiciones viven en lib/avisos.js.
  // Ver la autopsia del encabezado.
  const erroresLectura = [];
  const [recLlam, recSoli, recCons, recAvisTodos] = await Promise.all([
    leerTodo(C, C.LLAM, COLA_LLAMADOS, erroresLectura),
    leerTodo(C, C.SOLI, `{Estado}='Llamada pendiente'`, erroresLectura),
    leerTodo(C, C.CONS, `{Estado}='Nueva'`, erroresLectura),
    leerTodo(C, C.AVIS, COLA_AVISOS, erroresLectura),
  ]);

  // La ventana de los avisos se aplica en JS y no en la fórmula, para no depender
  // del huso con que Airtable evalúa DATEADD/TODAY().
  const ventanaMs = Number(env.AVISOS_VENTANA_DIAS || VENTANA_DIAS) * 86400 * 1000;
  const recAvis = recAvisTodos.filter(r => (ahora - new Date(r.createdTime).getTime()) <= ventanaMs);

  const marca = (r) => (r.fields?.['Aviso equipo enviado'] ? `esperando ${espera(desdeCuando(r), ahora)}` : '🆕 nadie lo ha visto');

  const secciones = [
    {
      key: 'llamados', tabla: C.LLAM, titulo: '📞 POR LLAMAR',
      items: ordenar(recLlam).map((r, i) => ({
        id: r.id, sellar: !r.fields?.['Aviso equipo enviado'],
        linea: `(${i + 1}) ${r.fields?.['Nombre'] || 'sin nombre'} · ${r.fields?.['Teléfono'] || 's/tel'}${r.fields?.['Canal'] ? ` · ${r.fields['Canal']}` : ''} · ${marca(r)}`,
      })),
    },
    {
      // El título ES la acción pendiente, en imperativo. Gabriel lo pidió con
      // esas palabras: «falta responderle a esta persona».
      key: 'avisos', tabla: C.AVIS, titulo: '🆘 FALTA RESPONDER',
      items: ordenar(recAvis).map((r, i) => {
        const f = r.fields || {};
        const quien = f['@handle IG'] ? `@${f['@handle IG']}` : (f['Subscriber ID'] ? `id ${f['Subscriber ID']}` : 'contacto sin nombre');
        const dijo = String(f['Mensaje'] || '').slice(0, 60);
        return {
          id: r.id, sellar: !f['Aviso equipo enviado'],
          linea: `(${i + 1}) ${quien}${f['Canal'] ? ` · ${f['Canal']}` : ''}${dijo ? ` · «${dijo}»` : ''} · ${marca(r)}`,
        };
      }),
    },
    {
      key: 'solicitudes', tabla: C.SOLI, titulo: '🔎 POR BUSCAR',
      items: ordenar(recSoli).map((r, i) => {
        const f = r.fields || {};
        return {
          id: r.id, sellar: !f['Aviso equipo enviado'],
          linea: `(${i + 1}) ${f['Modelo buscado'] || 'modelo por confirmar'}${f['Talla'] ? ` talla ${f['Talla']}` : ''}${f['Presupuesto'] != null ? ` · hasta ${clp(f['Presupuesto'])}` : ''} · ${f['Contacto'] || 's/tel'} · ${marca(r)}`,
        };
      }),
    },
    {
      key: 'consignaciones', tabla: C.CONS, titulo: '🚲 POR EVALUAR',
      items: ordenar(recCons).map((r, i) => {
        const f = r.fields || {};
        return {
          id: r.id, sellar: !f['Aviso equipo enviado'],
          linea: `(${i + 1}) ${f['Modelo'] || 'bici sin modelo'}${f['Precio esperado'] != null ? ` · pide ${clp(f['Precio esperado'])}` : ''} · ${f['Contacto'] || 's/tel'} · ${marca(r)}`,
        };
      }),
    },
  ];

  // Presupuesto compartido, en orden de urgencia: si la cola de llamadas está
  // desbordada se come el espacio, y las demás secciones dicen honestamente
  // cuántas quedaron fuera. Es la prioridad correcta: una llamada que se enfría
  // cuesta más que una consignación que espera un día.
  let queda = MAX_VAR;
  const partes = [];
  const armadas = {};
  for (const s of secciones) {
    if (!s.items.length) { armadas[s.key] = { dentro: [], faltan: 0, total: 0 }; continue; }
    const cabecera = `${s.titulo} · ${s.items.length}: `;
    if (queda < cabecera.length + 40) { armadas[s.key] = { dentro: [], faltan: s.items.length, total: s.items.length }; continue; }
    const a = armar(s.items, queda - cabecera.length);
    armadas[s.key] = { dentro: a.dentro, faltan: a.faltan, total: s.items.length };
    if (!a.dentro.length) continue;
    const trozo = cabecera + a.texto + (a.faltan ? `   (+${a.faltan} más)` : '');
    partes.push(trozo);
    queda -= trozo.length + 5;   // 5 = el separador ' || '
  }
  // Si alguna tabla no se pudo leer, el equipo tiene que ENTERARSE. Un briefing
  // que dice «nada pendiente» porque falló una lectura es peor que no mandar nada.
  const alarma = erroresLectura.length
    ? `⚠️ NO SE PUDO LEER ${[...new Set(erroresLectura.map(e => e.tabla))].join(', ')} — revísalo en Airtable`
    : '';
  const txtPendientes = partes.length
    ? [alarma, ...partes].filter(Boolean).join(' || ')
    : (alarma || 'nada pendiente 🌱');

  // ── 3 · Enviar ─────────────────────────────────────────────────────────────
  //
  // ⚠️ INTERRUPTOR DE PLANTILLA. `briefing_diario` (v1) tiene UNA sola variable:
  // `cf_agenda_hoy`. `briefing_diario_v2` tiene dos.
  //
  // Si se mandaran las dos variables mientras la v1 sigue apuntada, el mensaje
  // sólo imprimiría las visitas — y como más abajo se SELLA lo que «salió»,
  // quedaría marcado como avisado sin que nadie lo haya visto. Eso es exactamente
  // la pérdida silenciosa que este rediseño existe para eliminar. Por eso el
  // default es compatible con la v1 (todo junto en `cf_agenda_hoy`) y las dos
  // variables se activan con `BRIEFING_V2=1`, que se setea EN EL MISMO MOMENTO en
  // que `FLOW_NS_BRIEFING` pasa a apuntar a la v2.
  const v2 = String(env.BRIEFING_V2 || '') === '1';
  let envio = { enviados: 0, errores: [], motivo: 'dry' };
  if (!dry) {
    envio = v2
      ? await avisar(env, {
          tipo: 'briefing', flowEnv: 'FLOW_NS_BRIEFING',
          campo: 'cf_llamados_hoy', texto: txtPendientes,
          extra: { campo: 'cf_agenda_hoy', texto: txtVisitas },
          now,
        })
      : await avisar(env, {
          tipo: 'briefing', flowEnv: 'FLOW_NS_BRIEFING',
          campo: 'cf_agenda_hoy',
          texto: `${txtPendientes}   ||   📅 VISITAS DE HOY · ${txtVisitas}`,
          now,
        });
  }

  // ── 4 · Sellar SÓLO lo que entró de verdad en el mensaje ───────────────────
  // Si el briefing no salió a nadie, no se sella nada: el barrido los recoge uno
  // por uno. Degradación elegante — más mensajes, menos contexto, cero pérdida.
  const sellados = {};
  if (!dry && envio.enviados > 0 && C.WRITE) {
    for (const s of secciones) {
      const ids = (armadas[s.key]?.dentro || []).filter(x => x.sellar).map(x => x.id);
      sellados[s.key] = 0;
      for (let i = 0; i < ids.length; i += 10) {
        const lote = ids.slice(i, i + 10).map(id => ({ id, fields: { 'Aviso equipo enviado': now.toISOString() } }));
        const r = await afetch(C.api(s.tabla), {
          method: 'PATCH', headers: C.wH,
          body: JSON.stringify({ typecast: true, records: lote }),
        });
        if (r.ok) sellados[s.key] += lote.length;
      }
    }
  }

  return reply({
    ok: true, dry, force, fecha: hoy, plantilla: v2 ? 'v2 (2 variables)' : 'v1 (1 variable, todo junto)',
    visitas: recVisitas.length,
    colas: Object.fromEntries(secciones.map(s => [s.key, {
      total: armadas[s.key]?.total ?? 0,
      enElMensaje: armadas[s.key]?.dentro.length ?? 0,
      noCupieron: armadas[s.key]?.faltan ?? 0,
      sinAvisar: s.items.filter(x => x.sellar).length,
    }])),
    cf_llamados_hoy: unaLinea(txtPendientes),
    cf_agenda_hoy: unaLinea(txtVisitas),
    enviados: envio.enviados, errores: envio.errores, motivo: envio.motivo, falta: envio.falta,
    destinatarios: envio.destinatarios, sellados, erroresLectura,
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
