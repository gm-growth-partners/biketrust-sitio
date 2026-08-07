// Cloudflare Pages Function · GET/POST /api/cron-briefing
//
// EL BRIEFING DE LA MAÑANA. Sale a las 9:00 hora de Chile (env `BRIEFING_HOUR`),
// TODOS los días, a Luis, Roberto y Gabriel (env `BRIEFING_SIDS`).
//
// QUÉ MANDA — dos variables, no una:
//   {{1}} `cf_llamados_hoy` → la cola de llamados, marcando cuáles entraron
//                             fuera de horario y nadie ha visto todavía.
//   {{2}} `cf_agenda_hoy`   → las visitas agendadas para hoy.
// Se usan DOS porque una variable de plantilla no admite saltos de línea: con una
// sola, todo el briefing quedaba apelmazado en un párrafo. Los saltos viven en la
// parte fija de `briefing_diario_v2`.
//
// SU PAPEL EN EL SISTEMA (rediseño 2026-08-06)
// El briefing es LA RED de la franja horaria. Todo lo que entra entre las 20:00 y
// las 9:00 no dispara aviso individual: se acumula con el sello
// `Aviso equipo enviado` vacío, y este barrido lo lista y lo sella.
//
// Y lista TODA la cola pendiente, no sólo lo nuevo. Es a propósito: si un aviso
// individual salió un día que nadie estaba mirando, el lead igual reaparece acá
// mañana. Ningún lead puede caerse por el hueco entre «ya se avisó» y «alguien
// lo leyó».
//
// Env: AIRTABLE_TOKEN · MANYCHAT_TOKEN · FLOW_NS_BRIEFING · BRIEFING_SIDS ·
// BRIEFING_HOUR (default 9) · BRIEFING_DIAS (default todos).
// Protegido por CRON_KEY. Pruebas: ?dry=1 (arma y no manda) · ?force=1 (ignora la hora).

import {
  avisarStaff, unaLinea, hoyHayBriefing, briefingHora, chileHora, chileMin, chileFecha,
} from '../../lib/avisos.js';

const JSONH = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSONH });
const BASE_DEFAULT = 'appQUgk8aeD752923';

// Tope por variable de plantilla. Cada sección se arma ítem por ítem y se corta
// en el último que cabe entero, para no mandar una línea partida a la mitad.
const MAX_VAR = 880;

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

const cfg = (env) => {
  const BASE = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  return {
    BASE, READ, WRITE: env.AIRTABLE_WRITE_TOKEN,
    LEADS: env.AIRTABLE_LEADS_TABLE || 'Leads',
    INTER: env.AIRTABLE_INTERESES_TABLE || 'Intereses',
    LLAM: env.AIRTABLE_LLAMADOS_TABLE || 'Llamados',
    api: (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`,
    rH: { Authorization: `Bearer ${READ}` },
    wH: { Authorization: `Bearer ${env.AIRTABLE_WRITE_TOKEN}`, 'Content-Type': 'application/json' },
  };
};

// Lee TODAS las páginas. La versión anterior pedía `pageSize=25` y contaba
// `recs.length`: con 30 pendientes el encabezado decía «25 pendientes» — o sea que
// el número mentía HACIA ABAJO justo cuando el atraso crecía, que es cuando más
// importa que no mienta.
async function leerTodo(C, tabla, formula) {
  const out = [];
  let offset = '';
  for (let i = 0; i < 10; i++) {
    const u = `${C.api(tabla)}?pageSize=100&filterByFormula=${encodeURIComponent(formula)}${offset ? `&offset=${offset}` : ''}`;
    const r = await afetch(u, { headers: C.rH });
    if (!r.ok) break;
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

// Arma una sección respetando el presupuesto de caracteres y devuelve, además,
// QUÉ ítems entraron de verdad. Esa lista es la que se sella: si un ticket no
// cupo, no se sella y el barrido de las 09:15 lo manda como aviso individual.
// Ni silencio ni duplicado.
function armar(items, presupuesto = MAX_VAR) {
  const dentro = [];
  let txt = '';
  for (const it of items) {
    const pieza = (txt ? '   ' : '') + it.linea;
    if (txt.length + pieza.length > presupuesto) break;
    txt += pieza;
    dentro.push(it);
  }
  const faltan = items.length - dentro.length;
  return { texto: txt, dentro, faltan };
}

async function run(env, url) {
  const C = cfg(env);
  if (!C.READ) return reply({ error: 'not_configured (airtable)' }, 503);
  const dry = url.searchParams.get('dry') === '1';
  const force = url.searchParams.get('force') === '1';
  const now = new Date();

  // Gate de hora y de día. `hoyHayBriefing` devuelve true los 7 días salvo que se
  // acote con `BRIEFING_DIAS`: se decidió que salga todos los días (2026-08-06)
  // porque un día sin briefing es un día en que nadie se entera de lo que entró
  // de noche, y con Gabriel entre los destinatarios ya no hay razón para saltarlo.
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
  const visitas = armar(itemsVisitas);
  const txtVisitas = visitas.texto
    ? visitas.texto + (visitas.faltan ? `   (+${visitas.faltan} más)` : '')
    : 'sin visitas hoy 🌱';

  // ── 2 · LA COLA DE LLAMADOS ────────────────────────────────────────────────
  // Toda la cola, no sólo lo nuevo. Los que traen el sello vacío son los que
  // entraron fuera de horario y NADIE ha visto: van primero y marcados.
  const recLlam = await leerTodo(C, C.LLAM, `{Estado}='Llamada pendiente'`);
  const sinAvisar = recLlam.filter(r => !r.fields?.['Aviso equipo enviado']);
  const yaAvisados = recLlam.filter(r => r.fields?.['Aviso equipo enviado']);
  // Más viejo primero: el que lleva más esperando es el que más se enfría.
  const porEdad = (a, b) => String(a.createdTime).localeCompare(String(b.createdTime));
  sinAvisar.sort(porEdad); yaAvisados.sort(porEdad);

  const espera = (creado) => {
    const h = Math.round((Date.now() - new Date(creado).getTime()) / 3600000);
    return h >= 24 ? `${Math.round(h / 24)}d` : `${h}h`;
  };

  const itemsLlam = [...sinAvisar, ...yaAvisados].map((r, i) => {
    const f = r.fields || {};
    const nuevo = !f['Aviso equipo enviado'];
    return {
      id: r.id,
      nuevo,
      linea: `(${i + 1}) ${f['Nombre'] || 'sin nombre'} · ${f['Teléfono'] || 's/tel'} · ${nuevo ? '🆕 nadie lo ha visto' : `esperando ${espera(r.createdTime)}`}`,
    };
  });

  const llam = armar(itemsLlam);
  const txtLlamados = llam.texto
    ? `${recLlam.length} por llamar${sinAvisar.length ? ` (${sinAvisar.length} 🆕)` : ''}: ${llam.texto}${llam.faltan ? `   (+${llam.faltan} más)` : ''}`
    : 'sin llamados pendientes 🌱';

  // ── 3 · Enviar ─────────────────────────────────────────────────────────────
  //
  // ⚠️ INTERRUPTOR DE PLANTILLA. `briefing_diario` (v1, la que está viva hoy) tiene
  // UNA sola variable: `cf_agenda_hoy`. `briefing_diario_v2` tiene dos.
  //
  // Si se mandaran las dos variables mientras la v1 sigue apuntada, el mensaje
  // sólo imprimiría las visitas — y como más abajo se SELLAN los llamados que
  // «salieron», quedarían marcados como avisados sin que nadie los haya visto.
  // Eso es exactamente la pérdida silenciosa que este rediseño existe para
  // eliminar. Por eso el default es compatible con la v1 (todo junto en
  // `cf_agenda_hoy`) y las dos variables se activan con `BRIEFING_V2=1`, que se
  // setea EN EL MISMO MOMENTO en que `FLOW_NS_BRIEFING` pasa a apuntar a la v2.
  const v2 = String(env.BRIEFING_V2 || '') === '1';
  let envio = { enviados: 0, errores: [], motivo: 'dry' };
  if (!dry) {
    envio = v2
      ? await avisarStaff(env, {
          cual: 'briefing', flowEnv: 'FLOW_NS_BRIEFING',
          campo: 'cf_llamados_hoy', texto: txtLlamados,
          extra: { campo: 'cf_agenda_hoy', texto: txtVisitas },
        })
      : await avisarStaff(env, {
          cual: 'briefing', flowEnv: 'FLOW_NS_BRIEFING',
          campo: 'cf_agenda_hoy',
          texto: `📞 POR LLAMAR · ${txtLlamados}   ||   📅 VISITAS DE HOY · ${txtVisitas}`,
        });
  }

  // ── 4 · Sellar SÓLO lo que entró de verdad en el mensaje ───────────────────
  // Si el briefing no salió a nadie, no se sella nada: el barrido de las 09:15
  // los recoge uno por uno. Degradación elegante — más mensajes, menos contexto,
  // pero cero pérdida.
  const aSellar = llam.dentro.filter(x => x.nuevo).map(x => x.id);
  let sellados = 0;
  if (!dry && envio.enviados > 0 && C.WRITE && aSellar.length) {
    for (let i = 0; i < aSellar.length; i += 10) {
      const lote = aSellar.slice(i, i + 10).map(id => ({ id, fields: { 'Aviso equipo enviado': now.toISOString() } }));
      const r = await afetch(C.api(C.LLAM), {
        method: 'PATCH', headers: C.wH,
        body: JSON.stringify({ typecast: true, records: lote }),
      });
      if (r.ok) sellados += lote.length;
    }
  }

  return reply({
    ok: true, dry, force, fecha: hoy, plantilla: v2 ? 'v2 (2 variables)' : 'v1 (1 variable, todo junto)',
    visitas: recVisitas.length,
    llamados: { total: recLlam.length, sinAvisar: sinAvisar.length, enElMensaje: llam.dentro.length, noCupieron: llam.faltan },
    cf_llamados_hoy: unaLinea(txtLlamados),
    cf_agenda_hoy: unaLinea(txtVisitas),
    enviados: envio.enviados, errores: envio.errores, motivo: envio.motivo, falta: envio.falta,
    sellados,
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
