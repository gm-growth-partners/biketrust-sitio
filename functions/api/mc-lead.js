// Cloudflare Pages Function · POST /api/mc-lead
// Endpoint puente ManyChat → Airtable. Da de alta o "toca" un Lead identificado
// por su @handle de Instagram (el único dato estable que ManyChat tiene desde
// el primer contacto, antes de que el lead deje email/teléfono).
//
// Contrato (ver CLAUDE.md / PLAN_embudo.md — Día 3): todo lead que entra por
// el funnel de Instagram DEBE nacer aquí con `Fecha primer contacto`,
// `Estado` y `Canal origen` canónicos, o el reporte por período no lo cuenta.
//
// Lee con AIRTABLE_TOKEN, escribe con AIRTABLE_WRITE_TOKEN (igual que reservar.js).
// Protegido por env MC_KEY (?key=). Sin env → abierto (mismo criterio que
// recalcular-embudo/registrar-venta).

const JSONH = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSONH });

const BASE_DEFAULT = 'appQUgk8aeD752923';

async function afetch(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, opts);
    if (r.status !== 429 || i >= tries - 1) return r;
    await new Promise(res => setTimeout(res, 1200 * (i + 1)));
  }
}

function keyOk(env, url) {
  const need = env.MC_KEY;
  return need ? url.searchParams.get('key') === need : true;
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return reply({ error: 'unauthorized' }, 401);

  let data;
  try { data = await request.json(); }
  catch { return reply({ error: 'bad_json' }, 400); }

  const handle = String(data?.handle || '').trim().replace(/^@/, '');
  const canal  = String(data?.canal  || '').trim();
  const nombre = data?.nombre ? String(data.nombre).slice(0, 200) : '';
  const estado = data?.estado ? String(data.estado).trim() : 'nuevo';
  if (!handle || !canal) return reply({ error: 'missing_fields (handle, canal)' }, 422);

  const BASE  = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ  = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  const WRITE = env.AIRTABLE_WRITE_TOKEN;
  const LEADS = env.AIRTABLE_LEADS_TABLE || 'Leads';
  if (!READ || !WRITE) return reply({ error: 'not_configured' }, 503);

  const api = (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`;
  const rH  = { Authorization: `Bearer ${READ}` };
  const wH  = { Authorization: `Bearer ${WRITE}`, 'Content-Type': 'application/json' };
  const now = new Date().toISOString();
  const lowerHandle = handle.toLowerCase().replace(/'/g, "\\'");

  // 1) Buscar por @handle IG (case-insensitive) — es el identificador de dedup.
  let leadId = null, hadNombre = false;
  const formula = `LOWER({@handle IG})='${lowerHandle}'`;
  try {
    const u = `${api(LEADS)}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;
    const rr = await afetch(u, { headers: rH });
    if (rr.ok) {
      const j = await rr.json();
      const rec = j.records && j.records[0];
      if (rec) { leadId = rec.id; hadNombre = !!rec.fields.Nombre; }
    } else if (rr.status !== 404) {
      return reply({ error: 'airtable_read', status: rr.status, detail: await rr.text() }, 502);
    }
  } catch {
    return reply({ error: 'network' }, 502);
  }

  // 2a) Ya existe: solo "tocamos" la interacción. NO pisamos Canal origen ni
  //     Estado (eso avanza vía /api/mc-evento) — Canal origen es el de origen real.
  if (leadId) {
    const fields = { 'Fecha última interacción': now };
    if (nombre && !hadNombre) fields['Nombre'] = nombre;   // enriquece si faltaba
    const pr = await afetch(`${api(LEADS)}/${leadId}`, {
      method: 'PATCH', headers: wH,
      body: JSON.stringify({ typecast: true, fields }),
    });
    if (!pr.ok) return reply({ error: 'airtable_update', status: pr.status, detail: await pr.text() }, 502);
    return reply({ ok: true, leadId, created: false });
  }

  // 2b) No existe: nace el lead con el contrato completo.
  const cr = await afetch(api(LEADS), {
    method: 'POST', headers: wH,
    body: JSON.stringify({ typecast: true, fields: {
      '@handle IG': handle,
      ...(nombre ? { 'Nombre': nombre } : {}),
      'Canal origen': canal,
      'Estado': estado,
      'Fecha primer contacto': now,
      'Fecha última interacción': now,
    } }),
  });
  if (!cr.ok) return reply({ error: 'airtable_create', status: cr.status, detail: await cr.text() }, 502);
  const j = await cr.json();
  return reply({ ok: true, leadId: j.id, created: true });
}
// Sólo POST. Pages responde 405 automáticamente a otros métodos en esta ruta.
