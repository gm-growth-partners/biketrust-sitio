// Cloudflare Pages Function · POST /api/mc-waitlist
// Botón «🎯 Consíganmela» de la Puerta 2 (DM). Cuando mc-match no encontró el
// modelo (waitlist), el lead puede ENCARGARNOS la búsqueda: este endpoint guarda
// su teléfono + opt-in de WhatsApp y marca el Interés No-match como Encargo
// activo. El equipo lo ve en la cola de sourcing (Intereses con Encargo=✓) y le
// avisa cuando la consiga (manual hoy; plantilla reactivacion_stock a futuro).
//
// Body: { handle?, subscriber_id?, telefono?, optin?, modelo? }
//   - Identidad por handle o subscriber_id. El lead normalmente ya existe (lo
//     creó mc-match al buscar); si no existe y hay handle, nace acá (contrato
//     mc-lead, Canal=DM IG, Estado=no_match).
//   - modelo (opcional): respaldo por si no hay un Interés No-match previo — se
//     crea uno con ese texto en "Modelo buscado".
//
//   - Lead    → WhatsApp + Opt-in WhatsApp + Fecha opt-in + MC subscriber id +
//               Fecha última interacción (el Estado no se toca: mc-match ya lo dejó).
//   - Interés → el No-match más reciente del lead pasa a Encargo=✓ (reusa, no
//               duplica); si no existe, se crea con Encargo=✓.
//
// Lee con AIRTABLE_TOKEN, escribe con AIRTABLE_WRITE_TOKEN. Protegido por env
// MC_KEY (?key=). Sin env → abierto (mismo criterio que los otros puentes ManyChat).

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
  };
};

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return reply({ error: 'unauthorized' }, 401);

  let data;
  try { data = await request.json(); }
  catch { return reply({ error: 'bad_json' }, 400); }

  const handle = data?.handle ? String(data.handle).trim().replace(/^@/, '') : '';
  const subId = data?.subscriber_id ? String(data.subscriber_id).trim() : '';
  const telefono = data?.telefono ? String(data.telefono).slice(0, 60) : '';
  const optin = data?.optin === true || data?.optin === 1 || data?.optin === '1' || String(data?.optin).toLowerCase() === 'true';
  // Ignora merge tags sin resolver de ManyChat ({{cuf_…}}) — mismo bug que ya vimos.
  const modeloRaw = data?.modelo ? String(data.modelo).trim().slice(0, 200) : '';
  const modelo = modeloRaw.includes('{{') ? '' : modeloRaw;

  if (!handle && !subId) return reply({ error: 'missing_fields (handle o subscriber_id)' }, 422);

  const C = cfg(env);
  if (!C.READ || !C.WRITE) return reply({ error: 'not_configured' }, 503);
  const now = new Date().toISOString();
  const today = new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10); // Chile UTC-4

  // 1) Resolver el Lead: @handle IG → MC subscriber id.
  const findLead = async (formula) => {
    const u = `${C.api(C.LEADS)}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;
    const rr = await afetch(u, { headers: C.rH });
    if (!rr.ok) return { err: reply({ error: 'airtable_read', status: rr.status, detail: await rr.text() }, 502) };
    return { rec: (await rr.json()).records?.[0] || null };
  };
  let leadId = null, leadFields = null;
  if (handle) {
    const r = await findLead(`LOWER({@handle IG})='${handle.toLowerCase().replace(/'/g, "\\'")}'`);
    if (r.err) return r.err;
    if (r.rec) { leadId = r.rec.id; leadFields = r.rec.fields; }
  }
  if (!leadId && subId) {
    const r = await findLead(`{MC subscriber id}='${subId.replace(/'/g, "\\'")}'`);
    if (r.err) return r.err;
    if (r.rec) { leadId = r.rec.id; leadFields = r.rec.fields; }
  }

  // 1b) No existe: nace acá (normalmente mc-match ya lo creó, esto es respaldo).
  let leadCreado = false;
  if (!leadId) {
    if (!handle) return reply({ error: 'lead_not_found (se necesita handle para crear el lead)' }, 404);
    const cr = await afetch(C.api(C.LEADS), {
      method: 'POST', headers: C.wH,
      body: JSON.stringify({ typecast: true, fields: {
        '@handle IG': handle,
        'Canal origen': 'DM IG',
        'Estado': 'no_match',
        'Fecha primer contacto': now,
        'Fecha última interacción': now,
        ...(subId ? { 'MC subscriber id': subId } : {}),
      } }),
    });
    if (!cr.ok) return reply({ error: 'airtable_lead_create', status: cr.status, detail: await cr.text() }, 502);
    leadId = (await cr.json()).id; leadCreado = true;
  }

  // 2) Lead → contacto + opt-in (lo que vuelve alcanzable el encargo).
  const upd = { 'Fecha última interacción': now };
  if (telefono) upd['WhatsApp'] = telefono;
  if (optin) { upd['Opt-in WhatsApp'] = true; upd['Fecha opt-in'] = today; }
  if (subId && !leadFields?.['MC subscriber id']) upd['MC subscriber id'] = subId;
  const lp = await afetch(`${C.api(C.LEADS)}/${leadId}`, {
    method: 'PATCH', headers: C.wH,
    body: JSON.stringify({ typecast: true, fields: upd }),
  });
  if (!lp.ok) return reply({ error: 'airtable_lead_update', status: lp.status, detail: await lp.text() }, 502);

  // 3) El Interés No-match más reciente del lead → Encargo=✓ (reusa, no duplica).
  //    Se busca vía el lookup `Lead RecID` de Intereses.
  const f = `AND(FIND('${leadId}', ARRAYJOIN({Lead RecID})), {Resultado}='No-match')`;
  const iu = `${C.api(C.INTER)}?maxRecords=1&filterByFormula=${encodeURIComponent(f)}` +
    `&sort%5B0%5D%5Bfield%5D=${encodeURIComponent('Interés ID')}&sort%5B0%5D%5Bdirection%5D=desc`;
  const ir = await afetch(iu, { headers: C.rH });
  if (!ir.ok) return reply({ error: 'airtable_interes_read', status: ir.status, detail: await ir.text() }, 502);
  const interes = (await ir.json()).records?.[0] || null;

  let interesId = null, interesCreado = false, modeloBuscado = modelo;
  if (interes) {
    interesId = interes.id;
    modeloBuscado = interes.fields?.['Modelo buscado'] || modelo;
    const fields = { 'Encargo': true, 'Fecha': today };
    if (modelo && !interes.fields?.['Modelo buscado']) fields['Modelo buscado'] = modelo;
    const pr = await afetch(`${C.api(C.INTER)}/${interesId}`, {
      method: 'PATCH', headers: C.wH,
      body: JSON.stringify({ typecast: true, fields }),
    });
    if (!pr.ok) return reply({ error: 'airtable_interes_update', status: pr.status, detail: await pr.text() }, 502);
  } else {
    const cr = await afetch(C.api(C.INTER), {
      method: 'POST', headers: C.wH,
      body: JSON.stringify({ typecast: true, fields: {
        'Lead': [leadId],
        'Origen': 'Puerta 2 (quiz)',
        'Resultado': 'No-match',
        'Modelo buscado': modelo,
        'Encargo': true,
        'Fecha': today,
      } }),
    });
    if (!cr.ok) return reply({ error: 'airtable_interes_create', status: cr.status, detail: await cr.text() }, 502);
    interesId = (await cr.json()).id; interesCreado = true;
  }

  return reply({ ok: true, encargo: true, leadId, leadCreado, interesId, interesCreado, modeloBuscado: modeloBuscado || null });
}
// Sólo POST. Pages responde 405 automáticamente a otros métodos en esta ruta.
