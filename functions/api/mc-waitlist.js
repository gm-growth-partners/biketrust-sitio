// Cloudflare Pages Function · POST /api/mc-waitlist
// Botón «🎯 Consíganmela» de la Puerta 2 (DM). Cuando mc-match no encontró el
// modelo, el lead nos ENCARGA la búsqueda: el bot le pide los datos de la bici
// que busca (talla, presupuesto, detalles) + su teléfono, y este endpoint crea
// el TICKET en la tabla `Solicitudes` (Estado=Nueva) — la cola de sourcing que
// el staff trabaja desde la interfaz (cards por Estado). Los tickets manuales
// del staff se crean por formulario en la misma tabla (Origen=Manual).
//
// Body: { handle?, subscriber_id?, telefono?, optin?, modelo?, talla?,
//         presupuesto?, disciplina?, motorizacion?, notas? }
//   - Identidad por handle o subscriber_id. El lead normalmente ya existe (lo
//     creó mc-match al buscar); si no existe y hay handle, nace acá.
//   - `presupuesto` tolerante: "3000000", "$3.000.000", "Hasta $3 millones".
//   - Los merge tags sin resolver de ManyChat ({{cuf_…}}) se ignoran.
//
//   - Solicitud → Modelo buscado, Talla, Presupuesto, Disciplina, Motorización,
//                 Notas, Contacto, Estado=Nueva, Fecha, Origen=Bot DM, link Lead.
//   - Lead      → WhatsApp + Opt-in WhatsApp + Fecha opt-in + MC subscriber id +
//                 Fecha última interacción (el Estado no se toca: mc-match ya lo dejó).
//   - Interés   → el No-match más reciente del lead pasa a Encargo=✓ (marca de
//                 embudo; el ticket operativo vive en Solicitudes).
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

// ── Horario saludable por destinatario (hora Chile) ─────────────────────────
// Env AVISO_HORARIOS: "sid:d1-d2@h1-h2,..." — días 0=Dom..6=Sáb; se envía desde
// h1:00 hasta h2:00 (exclusivo). Un sid sin entrada recibe siempre. Default:
// Luis (579628082) L-S 9-20 · Roberto (302195575) todos los días 8-20.
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

// ── ManyChat helpers (mismo patrón que mc-consigna / cron-recordatorios) ────
// Para el AVISO A LUIS: setCustomFieldByName(cf_solicitud_datos) + sendFlow del
// flow de 1 nodo que envuelve la plantilla `nueva_solicitud` (Utility).
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

// Texto limpio: recorta, y descarta merge tags sin resolver ({{cuf_…}}).
const clean = (v, max = 200) => {
  const s = v == null ? '' : String(v).trim();
  return s.includes('{{') ? '' : s.slice(0, max);
};

// Presupuesto tolerante (mismo criterio que mc-match): "$3.000.000", "3 millones".
function parsePresupuesto(v) {
  const s = clean(v, 60).toLowerCase();
  if (!s) return null;
  const digits = s.replace(/[^0-9]/g, '');
  if (!digits) return null;
  let n = parseInt(digits, 10);
  if (/mill/.test(s) && n < 1000) n = n * 1000000;
  return n;
}

const cfg = (env) => {
  const BASE = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  const WRITE = env.AIRTABLE_WRITE_TOKEN;
  return {
    BASE, READ, WRITE,
    LEADS: env.AIRTABLE_LEADS_TABLE || 'Leads',
    INTER: env.AIRTABLE_INTERESES_TABLE || 'Intereses',
    SOLIC: env.AIRTABLE_SOLICITUDES_TABLE || 'Solicitudes',
    api: (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`,
    rH: { Authorization: `Bearer ${READ}` },
    wH: { Authorization: `Bearer ${WRITE}`, 'Content-Type': 'application/json' },
    // Aviso al staff — se activa solo cuando token + flow + destinatarios existen.
    // Admite varios ids separados por coma en AVISO_SOLICITUD_SIDS
    // (fallback LUIS_SUBSCRIBER_ID).
    MC_TOKEN: env.MANYCHAT_TOKEN || '',
    FLOW_SOLICITUD: env.FLOW_NS_SOLICITUD || '',
    STAFF_SIDS: String(env.AVISO_SOLICITUD_SIDS || env.LUIS_SUBSCRIBER_ID || '')
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
  const modelo = clean(data?.modelo);
  const talla = clean(data?.talla, 40);
  const presupuestoRaw = clean(data?.presupuesto, 60);
  const presupuesto = parsePresupuesto(presupuestoRaw);
  const disciplina = clean(data?.disciplina ?? data?.uso, 40);
  const motorizacion = clean(data?.motorizacion, 40);
  const notas = clean(data?.notas, 2000);
  // «Sin límite» (o cualquier respuesta sin cifra) no cabe en el campo currency →
  // se preserva en Notas: para el staff, "sin tope declarado" es un dato, no un vacío.
  const notasTicket = [notas, presupuestoRaw && presupuesto == null ? `Presupuesto: ${presupuestoRaw}` : '']
    .filter(Boolean).join(' · ');

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

  // 3) Crear el TICKET en Solicitudes (Estado=Llamada pendiente → el staff
  //    llama a confirmar detalles y lo pasa a Buscando).
  const sr = await afetch(C.api(C.SOLIC), {
    method: 'POST', headers: C.wH,
    body: JSON.stringify({ typecast: true, fields: {
      'Modelo buscado': modelo,
      'Estado': 'Llamada pendiente',
      'Origen': 'Bot DM',
      'Fecha': today,
      'Lead': [leadId],
      ...(talla ? { 'Talla': talla } : {}),
      ...(presupuesto != null ? { 'Presupuesto': presupuesto } : {}),
      ...(disciplina ? { 'Disciplina': disciplina } : {}),
      ...(motorizacion ? { 'Motorización': motorizacion } : {}),
      ...(notasTicket ? { 'Notas': notasTicket } : {}),
      ...(telefono ? { 'Contacto': telefono } : {}),
    } }),
  });
  if (!sr.ok) return reply({ error: 'airtable_solicitud_create', status: sr.status, detail: await sr.text() }, 502);
  const solicitudId = (await sr.json()).id;

  // 4) Marca de embudo: el Interés No-match más reciente del lead → Encargo=✓
  //    (best-effort: si falla no rompe el ticket, que ya quedó creado).
  let interesId = null;
  try {
    const f = `AND(FIND('${leadId}', ARRAYJOIN({Lead RecID})), {Resultado}='No-match')`;
    const iu = `${C.api(C.INTER)}?maxRecords=1&filterByFormula=${encodeURIComponent(f)}` +
      `&sort%5B0%5D%5Bfield%5D=${encodeURIComponent('Interés ID')}&sort%5B0%5D%5Bdirection%5D=desc`;
    const ir = await afetch(iu, { headers: C.rH });
    if (ir.ok) {
      const interes = (await ir.json()).records?.[0] || null;
      if (interes) {
        interesId = interes.id;
        const fields = { 'Encargo': true, 'Fecha': today };
        if (modelo && !interes.fields?.['Modelo buscado']) fields['Modelo buscado'] = modelo;
        await afetch(`${C.api(C.INTER)}/${interesId}`, {
          method: 'PATCH', headers: C.wH,
          body: JSON.stringify({ typecast: true, fields }),
        });
      }
    }
  } catch { /* best-effort */ }

  // 5) AVISO A LUIS por WhatsApp (best-effort: si falla, el ticket ya quedó
  //    creado — el staff igual lo ve en la página de Solicitudes).
  //    Requiere plantilla `nueva_solicitud` aprobada por Meta + 3 env:
  //    MANYCHAT_TOKEN · FLOW_NS_SOLICITUD (flow de 1 nodo) · LUIS_SUBSCRIBER_ID.
  let aviso = 'no_configurado';
  if (C.MC_TOKEN && C.FLOW_SOLICITUD && C.STAFF_SIDS.length) {
    try {
      const resumen = [
        modelo || 'modelo no indicado',
        talla ? `talla ${talla}` : '',
        presupuesto != null ? `hasta $${Number(presupuesto).toLocaleString('es-CL')}` : (presupuestoRaw ? `presupuesto: ${presupuestoRaw}` : ''),
        notas ? notas.slice(0, 120) : '',
        `contacto: ${telefono || 'sin teléfono'}`,
        handle ? `IG @${handle}` : '',
      ].filter(Boolean).join(' · ');
      let enviados = 0, dormidos = 0;
      for (const sid of C.STAFF_SIDS) {
        if (!horarioOk(env, sid)) { dormidos++; continue; }
        await mcSetField(C.MC_TOKEN, sid, 'cf_solicitud_datos', resumen.slice(0, 900));
        await mcSendFlow(C.MC_TOKEN, sid, C.FLOW_SOLICITUD);
        enviados++;
      }
      aviso = enviados ? 'enviado' + (dormidos ? ` (${dormidos} fuera de horario)` : '') : 'fuera_de_horario';
    } catch (e) {
      aviso = 'error: ' + String(e && e.message || e).slice(0, 200);
    }
  }

  return reply({ ok: true, encargo: true, solicitudId, leadId, leadCreado, interesId, modeloBuscado: modelo || null, aviso });
}
// Sólo POST. Pages responde 405 automáticamente a otros métodos en esta ruta.
