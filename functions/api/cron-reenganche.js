// Cloudflare Pages Function · GET/POST /api/cron-reenganche
// Motor de reenganche por WhatsApp (Etapa 7 / capa de recuperación). Barre leads
// alcanzables y dispara la plantilla que corresponde:
//   - NO-SHOW: Estado='no_show' (el staff lo marcó) → `seguimiento_noshow`.
//   - SUELTO : lead alcanzable (dio su teléfono) que se enfrió (>3 días sin
//     interacción) y NO avanzó a la visita → `seguimiento_suelto`.
// (Los sueltos que se pegan ANTES de dar el teléfono no son alcanzables por
//  WhatsApp → esos se recuperan por Instagram dentro de la ventana de 24h.)
// (Reactivación de stock = fase 2; requiere match bici↔lead.)
//
// Mecánica idéntica al motor de recordatorios: setCustomFieldByName(cf_bici) +
// sendFlow. Idempotente: estampa `Reenganche noshow` / `Reenganche suelto`.
// Sólo envía en horario diurno de Chile (9-20h) y sólo las ventanas cuyo
// FLOW_NS_* esté seteado (lanzamiento por fases). Protegido por CRON_KEY.
// ?dry=1 simula · ?force=1 ignora el horario.

const JSONH = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSONH });
const BASE_DEFAULT = 'appQUgk8aeD752923';
const MC_API = 'https://api.manychat.com';
const MAX_LEADS = 40;

async function afetch(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, opts);
    if (r.status !== 429 || i >= tries - 1) return r;
    await new Promise(res => setTimeout(res, 1200 * (i + 1)));
  }
}
const keyOk = (env, url) => { const need = env.CRON_KEY; return need ? url.searchParams.get('key') === need : true; };
const linkIds = (v) => (Array.isArray(v) ? v : []).map(x => (typeof x === 'string' ? x : x.id)).filter(Boolean);
const chileHour = (d) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', hour12: false }).format(d));

// Estados desde los que NO tiene sentido reenganchar como "suelto" (ya avanzaron
// o son terminales). El no-show se maneja por su propia rama.
const AVANZADOS = new Set(['visita_agendada', 'visita_confirmada', 'no_show', 'visitó', 'cerró', 'muerto', 'descartado']);

const cfg = (env) => {
  const BASE = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  const WRITE = env.AIRTABLE_WRITE_TOKEN;
  return {
    BASE, READ, WRITE,
    LEADS: env.AIRTABLE_LEADS_TABLE || 'Leads',
    INTER: env.AIRTABLE_INTERESES_TABLE || 'Intereses',
    api: (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`,
    rH: { Authorization: `Bearer ${READ}` },
    wH: { Authorization: `Bearer ${WRITE}`, 'Content-Type': 'application/json' },
    MC_TOKEN: env.MANYCHAT_TOKEN || '',
    FLOW_NOSHOW: env.FLOW_NS_NOSHOW || '',
    FLOW_SUELTO: env.FLOW_NS_SUELTO || '',
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
  if (!C.READ || !C.WRITE) return reply({ error: 'not_configured (airtable)' }, 503);
  const dry = url.searchParams.get('dry') === '1';
  const force = url.searchParams.get('force') === '1';
  const now = new Date();
  if (!force && !(chileHour(now) >= 9 && chileHour(now) < 20)) {
    return reply({ ok: true, skipped: 'fuera_de_horario', chileHour: chileHour(now) });
  }
  const mcReady = !!C.MC_TOKEN;

  // Alcanzables (dieron teléfono + opt-in), que sean no-show O estén fríos (>3 días).
  const formula =
    `AND({MC subscriber id}!='', {Opt-in WhatsApp}=1, ` +
    `OR({Estado}='no_show', DATETIME_DIFF(NOW(), {Fecha última interacción}, 'days')>=3))`;
  const listUrl = `${C.api(C.LEADS)}?pageSize=${MAX_LEADS}&filterByFormula=${encodeURIComponent(formula)}`;
  const rr = await afetch(listUrl, { headers: C.rH });
  if (!rr.ok) return reply({ error: 'airtable_read', status: rr.status, detail: await rr.text() }, 502);
  const records = (await rr.json()).records || [];

  const nowISO = now.toISOString();
  const sent = [], skipped = [], errors = [];

  for (const rec of records) {
    const f = rec.fields || {};
    const sid = String(f['MC subscriber id'] || '').trim();
    const estado = f['Estado'] || '';

    // Qué corresponde (a lo más uno por corrida): no-show > suelto.
    let tipo = null;
    if (estado === 'no_show' && !f['Reenganche noshow']) tipo = 'noshow';
    else if (!AVANZADOS.has(estado) && !f['Reenganche suelto']) tipo = 'suelto';
    if (!tipo) { skipped.push({ id: rec.id, estado }); continue; }

    const flowNs = tipo === 'noshow' ? C.FLOW_NOSHOW : C.FLOW_SUELTO;
    const campo = tipo === 'noshow' ? 'Reenganche noshow' : 'Reenganche suelto';

    let bici = String(f['MC bici'] || '').trim();
    if (!bici) { try { bici = await biciDe(C, f); } catch { bici = ''; } }
    if (!bici) { errors.push({ id: rec.id, tipo, error: 'sin_bici' }); continue; }

    if (dry || !mcReady || !flowNs) {
      skipped.push({ id: rec.id, tipo, bici, flowNs: flowNs || null, would_send: !!(flowNs && !dry), reason: dry ? 'dry' : (!mcReady ? 'mc_not_configured' : 'flow_not_configured') });
      continue;
    }

    try {
      const r1 = await mcPost(C.MC_TOKEN, '/fb/subscriber/setCustomFieldByName', { subscriber_id: mcSid(sid), field_name: 'cf_bici', field_value: bici });
      if (!r1.ok) throw new Error(`setField ${r1.status} ${await r1.text()}`);
      const r2 = await mcPost(C.MC_TOKEN, '/fb/sending/sendFlow', { subscriber_id: mcSid(sid), flow_ns: flowNs });
      if (!r2.ok) throw new Error(`sendFlow ${r2.status} ${await r2.text()}`);
      const lp = await afetch(`${C.api(C.LEADS)}/${rec.id}`, {
        method: 'PATCH', headers: C.wH, body: JSON.stringify({ typecast: true, fields: { [campo]: nowISO } }),
      });
      if (!lp.ok) throw new Error(`stamp ${campo}: ${lp.status} ${await lp.text()}`);
      sent.push({ id: rec.id, tipo, bici });
    } catch (e) {
      errors.push({ id: rec.id, tipo, error: String(e.message || e) });
    }
  }

  return reply({ ok: true, dry, mcReady, checked: records.length, sent, skipped, errors, at: nowISO });
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
