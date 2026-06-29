// Cloudflare Pages Function · POST /api/reservar
// Recibe una reserva del sitio y la escribe en Airtable (tabla "Reservas").
// El token de ESCRITURA vive SOLO aquí (variable de entorno, lado servidor),
// nunca llega al navegador. El sitio público sigue siendo HTML estático.

const JSONH = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSONH });

export async function onRequestPost({ request, env }) {
  let data;
  try { data = await request.json(); }
  catch { return reply({ error: 'bad_json' }, 400); }

  const { fecha, hora, modelos, nombre, email, telefono } = data || {};
  if (!fecha || !hora || !nombre || !email || !telefono ||
      !Array.isArray(modelos) || modelos.length === 0) {
    return reply({ error: 'missing_fields' }, 422);
  }

  const TOKEN = env.AIRTABLE_WRITE_TOKEN;                 // PAT con data.records:write
  const BASE  = env.AIRTABLE_BASE || 'appQUgk8aeD752923';
  const TABLE = env.AIRTABLE_RESERVAS_TABLE || 'Reservas';
  if (!TOKEN) return reply({ error: 'not_configured' }, 503);

  // Campos base (deben existir en la tabla) + opcionales (si faltan, no rompen).
  const base = {
    'Nombre':   String(nombre).slice(0, 200),
    'Email':    String(email).slice(0, 200),
    'Teléfono': String(telefono).slice(0, 60),
    'Fecha':    String(fecha).slice(0, 10),                // YYYY-MM-DD (campo Date)
    'Hora':     String(hora).slice(0, 10),                 // texto "10:30"
    'Modelos':  modelos.join(', ').slice(0, 2000),         // texto legible
    'Origen':   'Web',
    'Estado':   'Nueva'
  };
  const optional = {
    'Modelos Slug': (Array.isArray(data.modelosSlug) ? data.modelosSlug : []).join(', ').slice(0, 500),
    // record ids de Inventario (uno por bici elegida) → enlace duro Reserva ↔ bici para el CRM.
    'Bici IDs': (Array.isArray(data.modelosId) ? data.modelosId.filter(Boolean) : []).join(', ').slice(0, 500)
  };

  const url = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE)}`;
  const post = (fields) => fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, typecast: true })       // typecast: crea opciones de select si faltan
  });

  let r;
  try {
    r = await post({ ...base, ...optional });
    if (r.status === 422) {
      const txt = await r.text();
      // Algún campo opcional no existe en la tabla → reintenta sólo con los base.
      if (txt.includes('UNKNOWN_FIELD_NAME')) r = await post(base);
      else return reply({ error: 'airtable', status: 422, detail: txt }, 502);
    }
  } catch {
    return reply({ error: 'network' }, 502);
  }

  if (!r.ok) {
    const detail = await r.text();
    return reply({ error: 'airtable', status: r.status, detail }, 502);
  }

  // La reserva ya quedó guardada. Ahora poblamos el CRM (Lead + Intereses).
  // Best-effort: si algo del CRM falla, NO rompemos la confirmación al usuario.
  let reservaId = null;
  try { const j = await r.json(); reservaId = j && j.id; } catch {}
  if (reservaId) {
    try {
      await crmUpsert(env, reservaId, {
        nombre, email, telefono, fecha, hora,
        modelosId: Array.isArray(data.modelosId) ? data.modelosId.filter(Boolean) : []
      });
    } catch (e) { /* el CRM es best-effort; la reserva ya está a salvo */ }
  }

  return reply({ ok: true });
}

// ───────────────────────────────────────────────────────────────────────────
// CRM: upsert de Lead (por email o teléfono) + un Interés por bici reservada.
// Reemplaza la automatización "Run a script" de Airtable (que es de pago).
// Lee con AIRTABLE_TOKEN, escribe con AIRTABLE_WRITE_TOKEN. Usa typecast para
// que Airtable cree solo las opciones de los Single select que falten.
// ───────────────────────────────────────────────────────────────────────────
async function crmUpsert(env, reservaId, { nombre, email, telefono, fecha, hora, modelosId }) {
  const BASE  = env.AIRTABLE_BASE || 'appQUgk8aeD752923';
  const READ  = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;   // lectura (buscar lead)
  const WRITE = env.AIRTABLE_WRITE_TOKEN;
  const LEADS = env.AIRTABLE_LEADS_TABLE || 'Leads';
  const INTER = env.AIRTABLE_INTERESES_TABLE || 'Intereses';
  const api   = (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`;
  const wH    = { Authorization: `Bearer ${WRITE}`, 'Content-Type': 'application/json' };

  const emailLc = String(email || '').trim().toLowerCase();
  const last8   = String(telefono || '').replace(/\D/g, '').slice(-8);
  const biciIds = Array.isArray(modelosId) ? modelosId.filter(Boolean) : [];
  const now     = new Date().toISOString();   // sello de fechas del lead
  const fechaVisita = (fecha && hora) ? `${fecha}T${hora}:00` : (fecha ? `${fecha}T12:00:00` : null);

  // 1) Buscar Lead por email o por los últimos 8 dígitos del teléfono.
  let leadId = null, leadReservas = [];
  if (READ && (emailLc || last8)) {
    const clauses = [];
    if (emailLc) clauses.push(`LOWER({Email})='${emailLc.replace(/'/g, "\\'")}'`);
    if (last8)   clauses.push(`FIND('${last8}',{WhatsApp}&'')>0`);
    const formula = clauses.length > 1 ? `OR(${clauses.join(',')})` : clauses[0];
    const u = `${api(LEADS)}?maxRecords=1&fields%5B%5D=Reservas&filterByFormula=${encodeURIComponent(formula)}`;
    try {
      const rr = await fetch(u, { headers: { Authorization: `Bearer ${READ}` } });
      if (rr.ok) {
        const j = await rr.json();
        const rec = j.records && j.records[0];
        if (rec) {
          leadId = rec.id;
          leadReservas = (rec.fields.Reservas || []).map(x => (typeof x === 'string' ? x : x.id)).filter(Boolean);
        }
      }
    } catch {}
  }

  // 2) Crear o actualizar el Lead.
  if (leadId) {
    const reservas = Array.from(new Set([...leadReservas, reservaId]));
    await fetch(`${api(LEADS)}/${leadId}`, {
      method: 'PATCH', headers: wH,
      body: JSON.stringify({ typecast: true, fields: {
        'Estado': 'visita_agendada',
        'Fecha última interacción': now,
        ...(fechaVisita ? { 'Fecha visita': fechaVisita } : {}),
        'Reservas': reservas
      } })
    });
  } else {
    const rc = await fetch(api(LEADS), {
      method: 'POST', headers: wH,
      body: JSON.stringify({ typecast: true, fields: {
        'Nombre': String(nombre || '').slice(0, 200),
        'Email':  String(email  || '').slice(0, 200),
        'WhatsApp': String(telefono || '').slice(0, 60),
        'Canal origen': 'Web',
        'Estado': 'visita_agendada',
        'Fecha primer contacto': now,
        'Fecha última interacción': now,
        ...(fechaVisita ? { 'Fecha visita': fechaVisita } : {}),
        'Reservas': [reservaId]
      } })
    });
    if (rc.ok) { const j = await rc.json(); leadId = j.id; }
  }
  if (!leadId) return;   // sin Lead no hay dónde colgar los Intereses

  // 3) Un Interés por bici (o uno sin bici si la reserva no trajo ids).
  const records = (biciIds.length ? biciIds : [null]).map(id => ({
    fields: {
      'Lead': [leadId],
      ...(id ? { 'Bici': [id] } : {}),
      'Reservas': [reservaId],   // en tu tabla Intereses el link a Reservas es plural
      'Origen': 'Web (ficha)',
      'Resultado': 'Agendó',
      ...(fecha ? { 'Fecha': String(fecha).slice(0, 10) } : {})
    }
  }));
  await fetch(api(INTER), {
    method: 'POST', headers: wH,
    body: JSON.stringify({ typecast: true, records })
  });
}
// Sólo POST. Pages responde 405 automáticamente a otros métodos en esta ruta.
