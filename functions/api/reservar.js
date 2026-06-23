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

  const fields = {
    'Nombre':   String(nombre).slice(0, 200),
    'Email':    String(email).slice(0, 200),
    'Teléfono': String(telefono).slice(0, 60),
    'Fecha':    String(fecha).slice(0, 10),                // YYYY-MM-DD (campo Date)
    'Hora':     String(hora).slice(0, 10),                 // texto "10:30"
    'Modelos':  modelos.join(', ').slice(0, 2000),         // texto legible
    'Modelos slug': (Array.isArray(data.modelosSlug) ? data.modelosSlug : []).join(', ').slice(0, 500),
    'Origen':   'Web',
    'Estado':   'Nueva'
  };

  let r;
  try {
    r = await fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, typecast: true })    // typecast: crea opciones de select si faltan
    });
  } catch {
    return reply({ error: 'network' }, 502);
  }

  if (!r.ok) {
    const detail = await r.text();
    return reply({ error: 'airtable', status: r.status, detail }, 502);
  }
  return reply({ ok: true });
}
// Sólo POST. Pages responde 405 automáticamente a otros métodos en esta ruta.
