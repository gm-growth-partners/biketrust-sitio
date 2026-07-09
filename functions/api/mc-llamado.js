// Cloudflare Pages Function · POST /api/mc-llamado
// Ticket de LLAMADO para leads de región (Puerta 2). Cuando la persona no está
// en Santiago, en vez de agendar una visita al showroom se agenda una llamada:
// el bot captura ciudad + franja preferida + teléfono, crea el ticket en la
// tabla `Llamados` (Estado=Nueva) y avisa al staff por WhatsApp para que llame.
// La bici de interés viaja como dato (cf_hero_bici) y queda linkeada al ticket.
//
// Body: { handle?, subscriber_id?, telefono?, optin?, ciudad?, franja?, bici?, notas? }
//   - Identidad por handle o subscriber_id (el lead normalmente ya existe).
//   - IMPORTANTE: un llamado NO escribe `Fecha visita` en el Lead (eso activaría
//     los recordatorios de visita del motor cron). El ciclo del llamado vive en
//     su tarjeta: Nueva → Llamado → Cerrada.
//
//   - Llamado → Nombre (del lead), Teléfono, Ciudad, Franja, Bici de interés,
//               Estado=Nueva, Origen=Bot DM, Fecha, Notas, link Lead.
//   - Lead    → WhatsApp + Opt-in + MC subscriber id + Fecha última interacción.
//   - Aviso   → WhatsApp al staff (cf_llamado_datos + sendFlow). Por fases:
//               plantilla `nuevo_llamado` aprobada + env FLOW_NS_LLAMADO +
//               destinatarios en AVISO_LLAMADO_SIDS (o LUIS_SUBSCRIBER_ID),
//               ids de ManyChat separados por coma (Luis,Roberto).
//
// Lee con AIRTABLE_TOKEN, escribe con AIRTABLE_WRITE_TOKEN. Protegido por env
// MC_KEY (?key=). Sin env → abierto (mismo criterio que los otros puentes ManyChat).

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

function keyOk(env, url) {
  const need = env.MC_KEY;
  return need ? url.searchParams.get('key') === need : true;
}

// Texto limpio: recorta y descarta merge tags sin resolver ({{cuf_…}}).
const clean = (v, max = 200) => {
  const s = v == null ? '' : String(v).trim();
  return s.includes('{{') ? '' : s.slice(0, max);
};

// ── ManyChat helpers (mismo patrón que mc-consigna / cron-recordatorios) ────
async function mcPost(token, path, body) {
  return afetch(`${MC_API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
}
const mcSid = (s) => (/^\d+$/.test(s) ? Number(s) : s);
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

const cfg = (env) => {
  const BASE = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  const WRITE = env.AIRTABLE_WRITE_TOKEN;
  return {
    BASE, READ, WRITE,
    LEADS: env.AIRTABLE_LEADS_TABLE || 'Leads',
    LLAM: env.AIRTABLE_LLAMADOS_TABLE || 'Llamados',
    api: (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`,
    rH: { Authorization: `Bearer ${READ}` },
    wH: { Authorization: `Bearer ${WRITE}`, 'Content-Type': 'application/json' },
    // Aviso al staff — se activa cuando MC_TOKEN + flow + destinatarios existen.
    // Los destinatarios admiten varios ids separados por coma (Luis,Roberto).
    MC_TOKEN: env.MANYCHAT_TOKEN || '',
    FLOW_LLAMADO: env.FLOW_NS_LLAMADO || '',
    STAFF_SIDS: String(env.AVISO_LLAMADO_SIDS || env.LUIS_SUBSCRIBER_ID || '')
      .split(',').map(s => s.trim()).filter(Boolean),
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
  const telefono = clean(data?.telefono, 60);
  const optin = data?.optin === true || data?.optin === 1 || data?.optin === '1' || String(data?.optin).toLowerCase() === 'true';
  const ciudad = clean(data?.ciudad, 80);
  const franja = clean(data?.franja, 40);
  const biciIn = clean(data?.bici, 40);
  const notas = clean(data?.notas, 2000);

  if (!handle && !subId) return reply({ error: 'missing_fields (handle o subscriber_id)' }, 422);

  const C = cfg(env);
  if (!C.READ || !C.WRITE) return reply({ error: 'not_configured' }, 503);
  const now = new Date().toISOString();
  const today = new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10); // Chile UTC-4

  // 1) Resolver el Lead: @handle IG → MC subscriber id (respaldo: crear).
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
  let leadCreado = false;
  if (!leadId) {
    if (!handle) return reply({ error: 'lead_not_found (se necesita handle para crear el lead)' }, 404);
    const cr = await afetch(C.api(C.LEADS), {
      method: 'POST', headers: C.wH,
      body: JSON.stringify({ typecast: true, fields: {
        '@handle IG': handle,
        'Canal origen': 'DM IG',
        'Estado': 'nuevo',
        'Fecha primer contacto': now,
        'Fecha última interacción': now,
        ...(subId ? { 'MC subscriber id': subId } : {}),
      } }),
    });
    if (!cr.ok) return reply({ error: 'airtable_lead_create', status: cr.status, detail: await cr.text() }, 502);
    leadId = (await cr.json()).id; leadCreado = true;
    leadFields = {};
  }

  // 2) Lead → contacto + opt-in. OJO: sin `Fecha visita` (no es una visita).
  const upd = { 'Fecha última interacción': now };
  if (telefono) upd['WhatsApp'] = telefono;
  if (optin) { upd['Opt-in WhatsApp'] = true; upd['Fecha opt-in'] = today; }
  if (subId && !leadFields?.['MC subscriber id']) upd['MC subscriber id'] = subId;
  const lp = await afetch(`${C.api(C.LEADS)}/${leadId}`, {
    method: 'PATCH', headers: C.wH,
    body: JSON.stringify({ typecast: true, fields: upd }),
  });
  if (!lp.ok) return reply({ error: 'airtable_lead_update', status: lp.status, detail: await lp.text() }, 502);

  // 3) Crear el TICKET de llamado (Estado=Nueva → cola del staff).
  const nombre = leadFields?.Nombre || (handle ? '@' + handle : 'Lead de región');
  const lr = await afetch(C.api(C.LLAM), {
    method: 'POST', headers: C.wH,
    body: JSON.stringify({ typecast: true, fields: {
      'Nombre': nombre,
      'Estado': 'Nueva',
      'Origen': 'Bot DM',
      'Fecha': today,
      'Lead': [leadId],
      ...(telefono ? { 'Teléfono': telefono } : {}),
      ...(ciudad ? { 'Ciudad': ciudad } : {}),
      ...(franja ? { 'Franja': franja } : {}),
      ...(biciIn ? { 'Bici de interés': [biciIn] } : {}),
      ...(notas ? { 'Notas': notas } : {}),
    } }),
  });
  if (!lr.ok) return reply({ error: 'airtable_llamado_create', status: lr.status, detail: await lr.text() }, 502);
  const llamadoId = (await lr.json()).id;

  // 3b) Nombre del modelo para el resumen del aviso (best-effort).
  let biciNombre = '';
  if (biciIn) {
    const br = await afetch(`${C.api('Inventario')}/${biciIn}`, { headers: C.rH });
    if (br.ok) { const bf = (await br.json()).fields || {}; biciNombre = bf.Modelo || bf.Etiqueta || ''; }
  }

  // 4) AVISO AL STAFF por WhatsApp (best-effort; el ticket ya quedó creado).
  let aviso = 'no_configurado';
  if (C.MC_TOKEN && C.FLOW_LLAMADO && C.STAFF_SIDS.length) {
    try {
      const resumen = [
        nombre,
        ciudad ? `de ${ciudad}` : '',
        biciNombre ? `interesado en ${biciNombre}` : '',
        franja ? `llamar por la ${franja.toLowerCase()}` : '',
        telefono || 'sin teléfono',
      ].filter(Boolean).join(' · ');
      for (const sid of C.STAFF_SIDS) {
        await mcSetField(C.MC_TOKEN, sid, 'cf_llamado_datos', resumen.slice(0, 900));
        await mcSendFlow(C.MC_TOKEN, sid, C.FLOW_LLAMADO);
      }
      aviso = 'enviado';
    } catch (e) {
      aviso = 'error: ' + String(e && e.message || e).slice(0, 200);
    }
  }

  return reply({ ok: true, llamadoId, leadId, leadCreado, biciNombre: biciNombre || null, aviso });
}
// Sólo POST. Pages responde 405 automáticamente a otros métodos en esta ruta.
