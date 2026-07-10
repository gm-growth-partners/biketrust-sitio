// Cloudflare Pages Function · GET/POST /api/cron-briefing
// Briefing diario al staff (Luis): cada mañana a las 8:00 (hora Chile) le manda
// por WhatsApp la agenda de visitas de HOY. Reutiliza la mecánica del motor de
// recordatorios: arma el resumen del día, lo escribe en el campo `cf_agenda_hoy`
// del contacto de Luis (setCustomFieldByName) y dispara el flow de la plantilla
// `briefing_diario` (sendFlow). El {{1}} de la plantilla está mapeado a cf_agenda_hoy.
//
// La agenda va en UNA sola línea (WhatsApp no permite saltos de línea dentro de
// una variable de plantilla). Si no hay visitas → "sin visitas agendadas 🌱".
//
// Disparo: el worker-cron le pega en cada tick (*/15); este endpoint sólo envía
// cuando en Chile son las 09:0x (hora pedida por Luis 2026-07-10; ajustable
// con env BRIEFING_HOUR). Para probar: ?force=1 (ignora la hora) · ?dry=1
// (arma el texto pero no envía).
//
// Env: AIRTABLE_TOKEN/AIRTABLE_WRITE_TOKEN (aquí sólo lee), MANYCHAT_TOKEN,
// FLOW_NS_BRIEFING, LUIS_SUBSCRIBER_ID. Protegido por CRON_KEY. Sin credenciales
// de ManyChat/Luis → arma el resumen pero no envía (no-op seguro).

const JSONH = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSONH });
const BASE_DEFAULT = 'appQUgk8aeD752923';
const MC_API = 'https://api.manychat.com';

async function afetch(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, opts);
    if (r.status !== 429 || i >= tries - 1) return r;
    await new Promise(res => setTimeout(res, 1200 * (i + 1)));
  }
}
const keyOk = (env, url) => { const need = env.CRON_KEY; return need ? url.searchParams.get('key') === need : true; };
const linkIds = (v) => (Array.isArray(v) ? v : []).map(x => (typeof x === 'string' ? x : x.id)).filter(Boolean);

// Componentes de hora de Chile (DST-safe vía Intl).
const chileDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const chileHour = (d) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', hour12: false }).format(d));
const chileMin  = (d) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', minute: '2-digit' }).format(d));

// ── Horario saludable por destinatario (hora Chile) ─────────────────────────
// Env AVISO_HORARIOS: "sid:d1-d2@h1-h2,..." — días 0=Dom..6=Sáb. Un sid sin
// entrada recibe siempre. Default: Luis L-S 9-20 · Roberto todos los días 8-20.
// En el briefing esto hace que Luis NO reciba el de los domingos.
const HORARIOS_DEFAULT = '579628082:1-6@9-20,302195575:0-6@8-20';
function horarioOk(env, sid, now = new Date()) {
  const entry = String(env.AVISO_HORARIOS || HORARIOS_DEFAULT)
    .split(',').map(s => s.trim()).find(s => s.startsWith(String(sid) + ':'));
  if (!entry) return true;
  const m = entry.match(/:(\d)-(\d)@(\d{1,2})-(\d{1,2})$/);
  if (!m) return true;
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', hour: 'numeric', hour12: false, weekday: 'short' }).formatToParts(now);
  const hora = Number(p.find(x => x.type === 'hour').value);
  const dia = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.find(x => x.type === 'weekday').value];
  return dia >= Number(m[1]) && dia <= Number(m[2]) && hora >= Number(m[3]) && hora < Number(m[4]);
}
const chileHHMM = (iso) => new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

const cfg = (env) => {
  const BASE = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  return {
    BASE, READ,
    LEADS: env.AIRTABLE_LEADS_TABLE || 'Leads',
    INTER: env.AIRTABLE_INTERESES_TABLE || 'Intereses',
    api: (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`,
    rH: { Authorization: `Bearer ${READ}` },
    MC_TOKEN: env.MANYCHAT_TOKEN || '',
    FLOW_BRIEFING: env.FLOW_NS_BRIEFING || '',
    // Destinatarios del briefing: ids de ManyChat separados por coma
    // (BRIEFING_SIDS=Luis,Roberto; fallback LUIS_SUBSCRIBER_ID).
    STAFF_SIDS: String(env.BRIEFING_SIDS || env.LUIS_SUBSCRIBER_ID || '')
      .split(',').map(s => s.trim()).filter(Boolean),
  };
};

async function mcPost(token, path, body) {
  return afetch(`${MC_API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
}
const mcSid = (s) => (/^\d+$/.test(s) ? Number(s) : s);

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

async function run(env, url) {
  const C = cfg(env);
  if (!C.READ) return reply({ error: 'not_configured (airtable)' }, 503);
  const dry = url.searchParams.get('dry') === '1';
  const force = url.searchParams.get('force') === '1';
  const now = new Date();

  // Sólo a las HH:0x de Chile (salvo ?force=1) — 9:00 por pedido de Luis
  // (2026-07-10), ajustable con env BRIEFING_HOUR sin tocar código. El worker
  // pega cada 15 min; así sale una vez al día en el tick de la hora elegida.
  const briefingHour = Number(env.BRIEFING_HOUR || 9);
  if (!force && !(chileHour(now) === briefingHour && chileMin(now) < 15)) {
    return reply({ ok: true, skipped: 'not_briefing_time', chileHour: chileHour(now), chileMin: chileMin(now) });
  }

  const today = chileDate(now);
  const formula =
    `AND({Fecha visita}, ` +
    `DATETIME_FORMAT(SET_TIMEZONE({Fecha visita}, 'America/Santiago'), 'YYYY-MM-DD')='${today}', ` +
    `OR({Estado}='visita_agendada', {Estado}='visita_confirmada'))`;
  const listUrl = `${C.api(C.LEADS)}?pageSize=50&filterByFormula=${encodeURIComponent(formula)}`;
  const rr = await afetch(listUrl, { headers: C.rH });
  if (!rr.ok) return reply({ error: 'airtable_read', status: rr.status, detail: await rr.text() }, 502);
  const records = (await rr.json()).records || [];

  // Ordenar por hora y armar cada visita en una línea.
  records.sort((a, b) => String(a.fields['Fecha visita']).localeCompare(String(b.fields['Fecha visita'])));
  const items = [];
  for (let i = 0; i < records.length; i++) {
    const f = records[i].fields;
    const hora = chileHHMM(f['Fecha visita']);
    const nombre = f['Nombre'] || (f['@handle IG'] ? `@${f['@handle IG']}` : 'Sin nombre');
    const bici = (await biciDe(C, f)) || 'bici por confirmar';
    const tel = f['WhatsApp'] || 's/tel';
    items.push(`(${i + 1}) ${hora} · ${nombre} · ${bici} · ${tel}`);
  }
  const agenda = items.length ? items.join('   ') : 'sin visitas agendadas 🌱';

  const mcReady = !!(C.MC_TOKEN && C.FLOW_BRIEFING && C.STAFF_SIDS.length);
  let enviado = false, error = null;
  if (!dry && mcReady) {
    try {
      let enviadosN = 0;
      for (const s of C.STAFF_SIDS) {
        if (!horarioOk(env, s)) continue;   // ej: Luis no recibe el briefing los domingos
        const sid = mcSid(s);
        const r1 = await mcPost(C.MC_TOKEN, '/fb/subscriber/setCustomFieldByName', { subscriber_id: sid, field_name: 'cf_agenda_hoy', field_value: agenda });
        if (!r1.ok) throw new Error(`setField ${r1.status} ${await r1.text()}`);
        const r2 = await mcPost(C.MC_TOKEN, '/fb/sending/sendFlow', { subscriber_id: sid, flow_ns: C.FLOW_BRIEFING });
        if (!r2.ok) throw new Error(`sendFlow ${r2.status} ${await r2.text()}`);
        enviadosN++;
      }
      enviado = enviadosN > 0;
    } catch (e) { error = String(e.message || e); }
  }

  return reply({ ok: true, dry, mcReady, force, fecha: today, visitas: records.length, agenda, enviado, error });
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
