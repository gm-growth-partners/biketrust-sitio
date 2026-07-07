// Cloudflare Pages Function · POST /api/mc-evento
// Endpoint puente ManyChat → Airtable. Avanza el Estado de un Lead ya existente
// (creado por /api/mc-lead) y deja un Interés (ficha entregada, match, etc.),
// opcionalmente enlazado a una bici — resuelta directo (`bici`) o a través del
// reel comentado (`reel` = Post ID Instagram → Reels.Bici).
//
// Guarda de no-regresión: si llega un Estado "más atrás" que el actual (webhook
// repetido o fuera de orden), NO retrocede el Lead — solo registra el Interés y
// la interacción. Evita que un reintento de ManyChat arruine un lead ya avanzado.
//
// Lee con AIRTABLE_TOKEN, escribe con AIRTABLE_WRITE_TOKEN. Protegido por env
// MC_KEY (?key=). Sin env → abierto (mismo criterio que los otros endpoints).

const JSONH = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSONH });

const BASE_DEFAULT = 'appQUgk8aeD752923';

// Orden de la máquina de 13 estados (ver CLAUDE.md). 99 = terminal, siempre
// se puede setear (muerto/descartado cierran el lead desde cualquier punto).
const RANGO = {
  nuevo: 0,
  ficha_entregada: 1, quiz_iniciado: 1,
  quiz_abandonado: 2, match_entregado: 2, no_match: 2,
  visita_agendada: 3,
  visita_confirmada: 4,
  no_show: 5, 'visitó': 5,
  'cerró': 6,
  muerto: 99, descartado: 99,
};

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

const linkIds = (v) => (Array.isArray(v) ? v : []).map(x => (typeof x === 'string' ? x : x.id)).filter(Boolean);

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return reply({ error: 'unauthorized' }, 401);

  let data;
  try { data = await request.json(); }
  catch { return reply({ error: 'bad_json' }, 400); }

  const handle   = data?.handle ? String(data.handle).trim().replace(/^@/, '') : '';
  const leadIn   = data?.lead ? String(data.lead).trim() : '';
  const subId    = data?.subscriber_id ? String(data.subscriber_id).trim() : ''; // id ManyChat (vía fiable en WhatsApp)
  const estado   = data?.estado ? String(data.estado).trim() : '';
  const origen   = String(data?.origen || '').trim();
  const resultado = String(data?.resultado || '').trim();
  const reel     = data?.reel ? String(data.reel).trim() : '';
  const biciIn   = data?.bici ? String(data.bici).trim() : '';
  // soloEstado: solo avanza el Estado, sin crear Interés (ej. botón "Sí, confirmo").
  const soloEstado = data?.soloEstado === true || data?.soloEstado === 1 || String(data?.soloEstado).toLowerCase() === 'true';
  if (!leadIn && !handle && !subId) return reply({ error: 'missing_fields (lead, handle o subscriber_id)' }, 422);
  if (!soloEstado && (!origen || !resultado)) return reply({ error: 'missing_fields (origen, resultado)' }, 422);

  const BASE  = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ  = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  const WRITE = env.AIRTABLE_WRITE_TOKEN;
  const LEADS = env.AIRTABLE_LEADS_TABLE || 'Leads';
  const INTER = env.AIRTABLE_INTERESES_TABLE || 'Intereses';
  const REELS = env.AIRTABLE_REELS_TABLE || 'Reels';
  if (!READ || !WRITE) return reply({ error: 'not_configured' }, 503);

  const api = (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`;
  const rH  = { Authorization: `Bearer ${READ}` };
  const wH  = { Authorization: `Bearer ${WRITE}`, 'Content-Type': 'application/json' };
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  // 1) Resolver el Lead: id directo → @handle IG → MC subscriber id (fiable en
  //    WhatsApp, donde el @handle puede venir vacío — ej. el botón "Sí, confirmo").
  const findLead = async (formula) => {
    const u = `${api(LEADS)}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;
    const rr = await afetch(u, { headers: rH });
    if (!rr.ok) return { err: reply({ error: 'airtable_read', status: rr.status, detail: await rr.text() }, 502) };
    return { id: (await rr.json()).records?.[0]?.id || null };
  };
  let leadId = leadIn;
  if (!leadId && handle) {
    const r = await findLead(`LOWER({@handle IG})='${handle.toLowerCase().replace(/'/g, "\\'")}'`);
    if (r.err) return r.err;
    leadId = r.id;
  }
  if (!leadId && subId) {
    const r = await findLead(`{MC subscriber id}='${subId.replace(/'/g, "\\'")}'`);
    if (r.err) return r.err;
    leadId = r.id;
  }
  if (!leadId) return reply({ error: 'lead_not_found (llama /api/mc-lead primero)' }, 404);

  // 2) Leer el Lead completo (Estado actual, para la guarda de no-regresión).
  const lr = await afetch(`${api(LEADS)}/${leadId}`, { headers: rH });
  if (!lr.ok) return reply({ error: 'lead_not_found', status: lr.status }, 404);
  const leadFields = (await lr.json()).fields || {};
  const estadoActual = leadFields.Estado || 'nuevo';

  // 3) Resolver la bici: id directo, o vía el reel comentado (Reels.Bici).
  let biciId = biciIn, reelId = null;
  if (reel) {
    const u = `${api(REELS)}?maxRecords=1&filterByFormula=${encodeURIComponent(`{Post ID Instagram}='${reel.replace(/'/g, "\\'")}'`)}`;
    const rr = await afetch(u, { headers: rH });
    if (rr.ok) {
      const j = await rr.json();
      const rec = j.records && j.records[0];
      if (rec) { reelId = rec.id; if (!biciId) biciId = linkIds(rec.fields.Bici)[0] || ''; }
    }
  }

  // 4) Guarda de no-regresión: solo avanza el Estado si el rango es mayor
  //    (o el nuevo estado es desconocido/terminal, que siempre se respeta).
  let estadoAplicado = false;
  const fieldsLead = { 'Fecha última interacción': now };
  if (estado) {
    const rangoNuevo = estado in RANGO ? RANGO[estado] : 999;
    const rangoActual = estadoActual in RANGO ? RANGO[estadoActual] : 0;
    if (rangoNuevo >= rangoActual) { fieldsLead['Estado'] = estado; estadoAplicado = true; }
  }
  const lp = await afetch(`${api(LEADS)}/${leadId}`, {
    method: 'PATCH', headers: wH,
    body: JSON.stringify({ typecast: true, fields: fieldsLead }),
  });
  if (!lp.ok) return reply({ error: 'airtable_update', status: lp.status, detail: await lp.text() }, 502);

  // 5) Crear el Interés (registro de "qué pasó"), salvo en modo soloEstado
  //    (ej. "Sí, confirmo": solo avanza el Estado, no es un evento lead↔bici nuevo).
  let interesId = null;
  if (!soloEstado) {
    const interesFields = {
      'Lead': [leadId],
      'Origen': origen,
      'Resultado': resultado,
      'Fecha': today,
      ...(biciId ? { 'Bici': [biciId] } : {}),
      ...(reelId ? { 'Reel': [reelId] } : {}),
    };
    const ir = await afetch(api(INTER), {
      method: 'POST', headers: wH,
      body: JSON.stringify({ typecast: true, fields: interesFields }),
    });
    if (!ir.ok) return reply({ error: 'airtable_interes', status: ir.status, detail: await ir.text() }, 502);
    interesId = (await ir.json()).id;
  }

  return reply({
    ok: true, leadId, interesId, biciId: biciId || null,
    estadoActual: fieldsLead['Estado'] || estadoActual, estadoAplicado,
  });
}
// Sólo POST. Pages responde 405 automáticamente a otros métodos en esta ruta.
