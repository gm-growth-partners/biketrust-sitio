// Cloudflare Pages Function · GET/POST /api/registrar-venta
// "Conexión crítica" de la venta: deja en UN solo flujo atómico las 3 señales
// que antes se desincronizaban (Lead cerró · Interés Cerró · Bici Vendida).
//
//   - Lead      → Estado=cerró + Fecha cierre + Fecha última interacción
//   - Interés   → Resultado=Cerró + Fecha (reusa el del lead↔bici, o crea uno)
//   - Inventario→ Estado=Vendida + Fecha venta
//
// Escribe TODO directo y sincrónico (no depende de la automatización async de
// Airtable "Venta: Interés Cerró"; esa queda como red de seguridad idempotente
// y, además, NO estampa las fechas — por eso las ponemos acá).
//
// Walk-in (venta en tienda sin lead previo): si no llega `lead`, crea un lead
// mínimo y sigue el mismo flujo.
//
// Lee con AIRTABLE_TOKEN, escribe con AIRTABLE_WRITE_TOKEN.
// Disparo: botón de Airtable (Open URL) → GET con ?key= , o POST JSON (form/UI).
// Seguridad: env VENTA_KEY (o RECALC_KEY de respaldo) → ?key=. Sin env → abierto.

const BASE_DEFAULT = 'appQUgk8aeD752923';

// fetch con un reintento ante 429 (Airtable limita a 5 req/s). Endurece el
// camino de venta: una ráfaga no debe dejar la operación a medias.
async function afetch(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, opts);
    if (r.status !== 429 || i >= tries - 1) return r;
    await new Promise(res => setTimeout(res, 1200 * (i + 1)));
  }
}

// Fecha "de hoy" en horario de Chile (UTC-4) para los campos Date, y ahora ISO
// para el dateTime. Restar 4h evita que de madrugada caiga el día equivocado.
function nowStamps() {
  const iso = new Date().toISOString();
  const cl  = new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);
  return { iso, today: cl };
}

// Registra la venta. Devuelve un resumen de lo que hizo (para HTML/JSON).
// Exportada para poder testearla local (Cloudflare solo invoca onRequest*).
export async function registrarVenta(env, input) {
  const BASE  = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ  = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  const WRITE = env.AIRTABLE_WRITE_TOKEN;
  const LEADS = env.AIRTABLE_LEADS_TABLE      || 'Leads';
  const INTER = env.AIRTABLE_INTERESES_TABLE  || 'Intereses';
  const INV   = env.AIRTABLE_INVENTARIO_TABLE || 'Inventario';
  if (!READ || !WRITE) throw new Error('not_configured (faltan tokens)');

  const api = (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`;
  const rH  = { Authorization: `Bearer ${READ}` };
  const wH  = { Authorization: `Bearer ${WRITE}`, 'Content-Type': 'application/json' };
  const { iso, today } = nowStamps();

  const biciId   = String(input.bici || '').trim();
  let   leadId   = String(input.lead || '').trim();
  let   interesId = String(input.interes || '').trim();
  if (!biciId) throw new Error('missing_bici (falta el record id de la bici)');

  const out = { biciId, leadId: leadId || null, interesId: null, created: { lead: false, interes: false } };

  // 1) Walk-in: sin lead previo → crear un lead mínimo (cerró desde ya).
  if (!leadId) {
    const nombre = String(input.nombre || '').trim();
    if (!nombre && !input.telefono && !input.email) {
      throw new Error('missing_lead (sin `lead`, se requiere al menos `nombre` para walk-in)');
    }
    const rc = await afetch(api(LEADS), {
      method: 'POST', headers: wH,
      body: JSON.stringify({ typecast: true, fields: {
        'Nombre':  nombre.slice(0, 200),
        ...(input.email    ? { 'Email':    String(input.email).slice(0, 200) } : {}),
        ...(input.telefono ? { 'WhatsApp': String(input.telefono).slice(0, 60) } : {}),
        'Canal origen': 'Tienda',            // walk-in (opción nueva vía typecast)
        'Estado': 'cerró',
        'Fecha primer contacto': today,
        'Fecha última interacción': iso,
        'Fecha cierre': today,
      } }),
    });
    if (!rc.ok) throw new Error('crear_lead ' + rc.status + ' ' + (await rc.text()));
    leadId = (await rc.json()).id;
    out.leadId = leadId; out.created.lead = true;
  }

  // 2) Resolver el Interés a cerrar: id dado → buscar lead↔bici → crear.
  // OJO: el GET de un registro único NO acepta ?fields[] (da 422). Se lee el
  // registro completo y se toma el campo que interesa.
  if (!interesId) {
    const lr = await afetch(`${api(LEADS)}/${leadId}`, { headers: rH });
    if (lr.ok) {
      const ids = ((await lr.json()).fields?.Intereses || [])
        .map(x => (typeof x === 'string' ? x : x.id)).filter(Boolean);
      for (const id of ids) {
        const ir = await afetch(`${api(INTER)}/${id}`, { headers: rH });
        if (!ir.ok) continue;
        const b = ((await ir.json()).fields?.Bici || [])
          .map(x => (typeof x === 'string' ? x : x.id)).filter(Boolean);
        if (b.includes(biciId)) { interesId = id; break; }
      }
    }
  }

  if (interesId) {
    // Reusar el interés existente: pasarlo a Cerró (no duplicar).
    const pr = await afetch(`${api(INTER)}/${interesId}`, {
      method: 'PATCH', headers: wH,
      body: JSON.stringify({ typecast: true, fields: { 'Resultado': 'Cerró', 'Fecha': today } }),
    });
    if (!pr.ok) throw new Error('cerrar_interes ' + pr.status + ' ' + (await pr.text()));
  } else {
    // No había interés lead↔bici → crear uno ya Cerró.
    const cr = await afetch(api(INTER), {
      method: 'POST', headers: wH,
      body: JSON.stringify({ typecast: true, fields: {
        'Lead': [leadId], 'Bici': [biciId],
        'Resultado': 'Cerró', 'Fecha': today,
      } }),
    });
    if (!cr.ok) throw new Error('crear_interes ' + cr.status + ' ' + (await cr.text()));
    interesId = (await cr.json()).id; out.created.interes = true;
  }
  out.interesId = interesId;

  // 3) Lead → cerró + fechas (idempotente con la automatización; suma las fechas).
  const lp = await afetch(`${api(LEADS)}/${leadId}`, {
    method: 'PATCH', headers: wH,
    body: JSON.stringify({ typecast: true, fields: {
      'Estado': 'cerró',
      'Fecha cierre': today,
      'Fecha última interacción': iso,
    } }),
  });
  if (!lp.ok) throw new Error('cerrar_lead ' + lp.status + ' ' + (await lp.text()));

  // 4) Bici → Vendida + Fecha venta. Sale del catálogo en el próximo build.
  const bp = await afetch(`${api(INV)}/${biciId}`, {
    method: 'PATCH', headers: wH,
    body: JSON.stringify({ typecast: true, fields: {
      'Estado': 'Vendida',
      'Fecha venta': today,
    } }),
  });
  if (!bp.ok) throw new Error('vender_bici ' + bp.status + ' ' + (await bp.text()));

  return out;
}

function keyOk(env, url) {
  const need = env.VENTA_KEY || env.RECALC_KEY;
  return need ? url.searchParams.get('key') === need : true;
}

// GET → botón de Airtable (Open URL). Lee params y responde HTML legible.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return new Response('No autorizado', { status: 401 });
  const q = url.searchParams;
  try {
    const r = await registrarVenta(env, {
      bici: q.get('bici'), lead: q.get('lead'), interes: q.get('interes'),
      nombre: q.get('nombre'), telefono: q.get('telefono'), email: q.get('email'),
    });
    const html = `<!doctype html><meta charset="utf-8"><title>Venta registrada</title>
<body style="font-family:system-ui,Segoe UI,sans-serif;max-width:520px;margin:48px auto;padding:0 16px;color:#1d2433">
<h2>✅ Venta registrada</h2>
<p>Quedó todo conectado de una vez:</p>
<ul style="line-height:1.8">
<li><b>Lead</b> marcado <code>cerró</code> con fecha de cierre${r.created.lead ? ' (creado walk-in)' : ''}.</li>
<li><b>Interés</b> marcado <code>Cerró</code>${r.created.interes ? ' (creado)' : ' (reusado)'}.</li>
<li><b>Bici</b> marcada <code>Vendida</code> con fecha de venta.</li>
</ul>
<p>Ya puedes cerrar esta pestaña y volver al panel.</p></body>`;
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (e) {
    return new Response('Error: ' + (e && e.message || e), { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

// POST → form walk-in / UI futura. Responde JSON.
export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  let data;
  try { data = await request.json(); }
  catch { return new Response(JSON.stringify({ error: 'bad_json' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }
  try {
    const r = await registrarVenta(env, data || {});
    return new Response(JSON.stringify({ ok: true, ...r }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
}
