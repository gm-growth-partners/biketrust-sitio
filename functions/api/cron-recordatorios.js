// Cloudflare Pages Function · GET/POST /api/cron-recordatorios
// Motor de recordatorios por WhatsApp (Fase 3 del embudo, EMBUDO.md §8).
//
// Barre los Leads con visita agendada próxima y, cuando entran en la ventana de
// 48h o 2h, dispara la plantilla de WhatsApp correspondiente vía la API de ManyChat:
//   1) setCustomFieldByName cf_bici  = modelo de la bici
//   2) setCustomFieldByName cf_fecha_visita = fecha legible (48h) u hora sola (2h)
//   3) sendFlow flow_ns = el flow de un nodo que envuelve la plantilla aprobada
// Al enviar, estampa `Recordatorio 48h/2h` en el Lead → idempotente (no re-envía).
// Si el lead reagenda, mc-agenda limpia esos dos campos → el ciclo se reinicia.
//
// NO tiene cron nativo: Pages Functions no soporta triggers programados. Lo dispara
// un Worker de Cloudflare con Cron Trigger (ver worker-cron/) que pega esta URL
// cada ~15 min. Protegido por env CRON_KEY (?key=). Sin env → abierto.
//
// Lee con AIRTABLE_TOKEN, escribe con AIRTABLE_WRITE_TOKEN. Envía con MANYCHAT_TOKEN.
// Flows por env: FLOW_NS_48H, FLOW_NS_2H. Sin credenciales de ManyChat → no-op
// seguro (para poder desplegar antes de que el cliente arme los flows).
//
// ?dry=1 → calcula a quién le tocaría, pero NO envía ni escribe (para probar).

const JSONH = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSONH });

const BASE_DEFAULT = 'appQUgk8aeD752923';
const MC_API = 'https://api.manychat.com';
const MAX_LEADS = 30; // colchón de subrequests; el showroom es de bajo volumen.

async function afetch(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, opts);
    if (r.status !== 429 || i >= tries - 1) return r;
    await new Promise(res => setTimeout(res, 1200 * (i + 1)));
  }
}

function keyOk(env, url) {
  const need = env.CRON_KEY;
  return need ? url.searchParams.get('key') === need : true;
}

const linkIds = (v) => (Array.isArray(v) ? v : []).map(x => (typeof x === 'string' ? x : x.id)).filter(Boolean);

// Formatea un instante (ISO UTC de Airtable) a hora de Chile (DST-safe vía Intl).
//   full → "sábado, 10 de julio, 11:00"  ·  hora → "11:00"
function fmtChile(iso) {
  const d = new Date(iso);
  const fecha = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago', weekday: 'long', day: 'numeric', month: 'long',
  }).format(d);
  const hora = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
  return { full: `${fecha}, ${hora}`, hora };
}

const cfg = (env) => {
  const BASE  = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ  = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  const WRITE = env.AIRTABLE_WRITE_TOKEN;
  return {
    BASE, READ, WRITE,
    LEADS: env.AIRTABLE_LEADS_TABLE || 'Leads',
    INTER: env.AIRTABLE_INTERESES_TABLE || 'Intereses',
    api: (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`,
    rH: { Authorization: `Bearer ${READ}` },
    wH: { Authorization: `Bearer ${WRITE}`, 'Content-Type': 'application/json' },
    MC_TOKEN: env.MANYCHAT_TOKEN || '',
    FLOW_48H: env.FLOW_NS_48H || '',
    FLOW_8AM: env.FLOW_NS_8AM || '',
    FLOW_2H:  env.FLOW_NS_2H  || '',
  };
};

// Fecha (YYYY-MM-DD) y hora (0-23) de un instante en hora de Chile (DST-safe).
const chileDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const chileHour = (d) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', hour12: false }).format(d));

// ── ManyChat helpers ────────────────────────────────────────────────────────
async function mcPost(token, path, body) {
  return afetch(`${MC_API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
}
const mcSid = (s) => (/^\d+$/.test(s) ? Number(s) : s); // ManyChat usa id numérico.

async function mcSetField(token, sid, name, value) {
  const r = await mcPost(token, '/fb/subscriber/setCustomFieldByName', {
    subscriber_id: mcSid(sid), field_name: name, field_value: value,
  });
  if (!r.ok) throw new Error(`setField ${name}: ${r.status} ${await r.text()}`);
}
async function mcSendFlow(token, sid, flowNs) {
  const r = await mcPost(token, '/fb/sending/sendFlow', {
    subscriber_id: mcSid(sid), flow_ns: flowNs,
  });
  if (!r.ok) throw new Error(`sendFlow: ${r.status} ${await r.text()}`);
}

// Resuelve el modelo de la bici de la visita cuando el Lead no trae `MC bici`
// (leads agendados antes de este motor). Best-effort: Interés "Agendó" con bici,
// o el más reciente con bici → Inventario.Modelo.
async function resolverBici(C, leadFields) {
  const ids = linkIds(leadFields.Intereses);
  let biciId = '';
  const conBici = [];
  for (const id of ids) {
    const ir = await afetch(`${C.api(C.INTER)}/${id}`, { headers: C.rH });
    if (!ir.ok) continue;
    const f = (await ir.json()).fields || {};
    const b = linkIds(f.Bici)[0];
    if (b) conBici.push({ b, agendo: f.Resultado === 'Agendó' });
  }
  biciId = (conBici.find(x => x.agendo) || conBici[conBici.length - 1] || {}).b || '';
  if (!biciId) return '';
  const br = await afetch(`${C.api('Inventario')}/${biciId}`, { headers: C.rH });
  if (!br.ok) return '';
  const bf = (await br.json()).fields || {};
  return bf.Modelo || bf.Etiqueta || '';
}

// ── Barrido principal ───────────────────────────────────────────────────────
async function run(env, url) {
  const C = cfg(env);
  if (!C.READ || !C.WRITE) return reply({ error: 'not_configured (airtable)' }, 503);
  const dry = url.searchParams.get('dry') === '1';
  // Basta el token para operar; cada ventana se envía sólo si su flow_ns existe
  // (lanzamiento por fases: 48h/8am pueden ir vivos antes que el 2h).
  const mcReady = !!C.MC_TOKEN;

  // Sólo leads con visita futura dentro de ~50h, en estado agendada/confirmada,
  // con opt-in y con subscriber_id de ManyChat.
  const formula =
    `AND({Fecha visita}, IS_AFTER({Fecha visita}, NOW()),` +
    ` DATETIME_DIFF({Fecha visita}, NOW(), 'hours') <= 50,` +
    ` OR({Estado}='visita_agendada', {Estado}='visita_confirmada'),` +
    ` {Opt-in WhatsApp}=1, {MC subscriber id}!='')`;
  const listUrl = `${C.api(C.LEADS)}?pageSize=${MAX_LEADS}&filterByFormula=${encodeURIComponent(formula)}`;
  const rr = await afetch(listUrl, { headers: C.rH });
  if (!rr.ok) return reply({ error: 'airtable_read', status: rr.status, detail: await rr.text() }, 502);
  const records = (await rr.json()).records || [];

  const now = Date.now();
  const nowISO = new Date().toISOString();
  const sent = [], skipped = [], errors = [];

  for (const rec of records) {
    const f = rec.fields || {};
    const sid = String(f['MC subscriber id'] || '').trim();
    const fv = f['Fecha visita'];
    const fvDate = new Date(fv);
    const hours = (fvDate.getTime() - now) / 3600000;
    const nowDate = new Date(now);

    // Qué toca (a lo más una plantilla por corrida; prioridad 2h > 8am > 48h):
    //   - 2h  : faltan ≤2h para la visita.
    //   - 8am : es el DÍA de la visita y ya son ≥08:00 en Chile (aviso matinal),
    //           salvo que falten ≤2.5h (esa parte la cubre el recordatorio de 2h).
    //   - 48h : dentro de las 48h y a más de 6h (aviso "un par de días antes").
    let ventana = null;
    if (!f['Recordatorio 2h'] && hours <= 2 && hours > -1) ventana = '2h';
    else if (!f['Recordatorio 8am'] && chileDate(fvDate) === chileDate(nowDate) && chileHour(nowDate) >= 8 && hours > 2.5) ventana = '8am';
    else if (!f['Recordatorio 48h'] && hours <= 48 && hours > 6) ventana = '48h';
    if (!ventana) { skipped.push({ id: rec.id, hours: +hours.toFixed(1) }); continue; }

    // Bici para {{1}}: cache en el Lead o fallback vía Intereses.
    let bici = String(f['MC bici'] || '').trim();
    if (!bici) { try { bici = await resolverBici(C, f); } catch { bici = ''; } }
    if (!bici) { errors.push({ id: rec.id, ventana, error: 'sin_bici' }); continue; }

    const { full, hora } = fmtChile(fv);
    // El 48h lleva fecha completa; el 8am y el 2h (mismo día) llevan solo la hora.
    const cfFecha = ventana === '48h' ? full : hora;
    const flowNs = ventana === '2h' ? C.FLOW_2H : ventana === '8am' ? C.FLOW_8AM : C.FLOW_48H;
    const campo  = ventana === '2h' ? 'Recordatorio 2h' : ventana === '8am' ? 'Recordatorio 8am' : 'Recordatorio 48h';

    if (dry || !mcReady) {
      skipped.push({ id: rec.id, ventana, bici, cfFecha, flowNs: flowNs || null, would_send: !!flowNs, reason: dry ? 'dry' : 'manychat_not_configured' });
      continue;
    }
    // Esa ventana todavía no tiene flow (ej. el 2h antes de aprobar recordatorio_final).
    if (!flowNs) { skipped.push({ id: rec.id, ventana, reason: 'flow_not_configured' }); continue; }

    try {
      await mcSetField(C.MC_TOKEN, sid, 'cf_bici', bici);
      await mcSetField(C.MC_TOKEN, sid, 'cf_fecha_visita', cfFecha);
      await mcSendFlow(C.MC_TOKEN, sid, flowNs);
      const lp = await afetch(`${C.api(C.LEADS)}/${rec.id}`, {
        method: 'PATCH', headers: C.wH,
        body: JSON.stringify({ typecast: true, fields: { [campo]: nowISO } }),
      });
      if (!lp.ok) throw new Error(`stamp ${campo}: ${lp.status} ${await lp.text()}`);
      sent.push({ id: rec.id, ventana, bici });
    } catch (e) {
      errors.push({ id: rec.id, ventana, error: String(e.message || e) });
    }
  }

  return reply({
    ok: true, dry, mcReady, checked: records.length,
    sent, skipped, errors, at: nowISO,
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
