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

  let   biciId    = String(input.bici || '').trim();
  let   leadId    = String(input.lead || '').trim();
  let   interesId = String(input.interes || '').trim();

  const out = { biciId: biciId || null, leadId: leadId || null, interesId: null, created: { lead: false, interes: false } };

  // 1) Walk-in: sin lead previo → crear un lead mínimo (cerró desde ya).
  //    Requiere `bici` en el input (un lead nuevo no tiene "Bici comprada").
  if (!leadId) {
    if (!biciId) throw new Error('missing_bici (walk-in requiere `bici`)');
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

  // 2) Leer el lead UNA vez para: (a) sacar la bici de "Bici comprada" si no vino
  //    en el input — es lo que el staff elige en la Agenda — y (b) sus Intereses
  //    para resolver cuál cerrar. OJO: el GET de un registro único NO acepta
  //    ?fields[] (da 422) → se lee completo.
  const linkIds = (v) => (Array.isArray(v) ? v : []).map(x => (typeof x === 'string' ? x : x.id)).filter(Boolean);
  let leadFields = null;
  if (!biciId || !interesId) {
    const lr = await afetch(`${api(LEADS)}/${leadId}`, { headers: rH });
    if (lr.ok) leadFields = (await lr.json()).fields || {};
  }
  if (!biciId && leadFields) biciId = linkIds(leadFields['Bici comprada'])[0] || '';
  if (!biciId) throw new Error('missing_bici (elige la bici comprada en el lead)');
  out.biciId = biciId;

  // 3) Resolver el Interés a cerrar: id dado → buscar lead↔bici → crear.
  if (!interesId && leadFields) {
    for (const id of linkIds(leadFields.Intereses)) {
      const ir = await afetch(`${api(INTER)}/${id}`, { headers: rH });
      if (!ir.ok) continue;
      if (linkIds((await ir.json()).fields?.Bici).includes(biciId)) { interesId = id; break; }
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

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clp = (n) => (n == null || n === '') ? '' : '$' + Number(n).toLocaleString('es-CL');

// ─── El FORMULARIO de venta única (?form=1) ─────────────────────────────────
// El único camino de registro para el staff: elige la bici, y si venía agendado
// elige el lead — si es walk-in, nombre + teléfono. El submit hace POST a este
// mismo endpoint (flujo atómico de siempre). Botón "Registrar venta" del Panel
// de inventario → Open URL a /api/registrar-venta?form=1&key=VENTA_KEY.
async function formHTML(env, key) {
  const BASE = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  const INV = env.AIRTABLE_INVENTARIO_TABLE || 'Inventario';
  const LEADS = env.AIRTABLE_LEADS_TABLE || 'Leads';
  const api = (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`;
  const rH = { Authorization: `Bearer ${READ}` };

  // Bicis vendibles (Disponible + Reservada).
  const bu = `${api(INV)}?pageSize=100&filterByFormula=${encodeURIComponent("OR({Estado}='Disponible',{Estado}='Reservada')")}` +
    ['Etiqueta', 'Precio', 'Estado'].map(f => '&fields%5B%5D=' + encodeURIComponent(f)).join('');
  const br = await afetch(bu, { headers: rH });
  const bicis = br.ok ? ((await br.json()).records || []) : [];

  // Leads activos (no cerrados/terminales), los más recientes primero.
  const lu = `${api(LEADS)}?pageSize=100&filterByFormula=${encodeURIComponent("NOT(OR({Estado}='cerró',{Estado}='muerto',{Estado}='descartado'))")}` +
    `&sort%5B0%5D%5Bfield%5D=${encodeURIComponent('Fecha última interacción')}&sort%5B0%5D%5Bdirection%5D=desc` +
    ['Lead', 'Estado', 'Fecha visita'].map(f => '&fields%5B%5D=' + encodeURIComponent(f)).join('');
  const lr = await afetch(lu, { headers: rH });
  const leads = lr.ok ? ((await lr.json()).records || []) : [];

  const biciOpts = bicis
    .sort((a, b) => String(a.fields.Etiqueta).localeCompare(String(b.fields.Etiqueta)))
    .map(b => `<option value="${esc(b.id)}">${esc(b.fields.Etiqueta)} · ${clp(b.fields.Precio)}${b.fields.Estado === 'Reservada' ? ' · reservada' : ''}</option>`).join('');
  const leadOpts = leads.map(l => {
    const f = l.fields;
    const visita = f['Fecha visita'] ? ' · visita ' + String(f['Fecha visita']).slice(0, 10) : '';
    return `<option value="${esc(l.id)}">${esc(f.Lead || 'Sin nombre')} · ${esc(f.Estado || '')}${visita}</option>`;
  }).join('');

  return `<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Registrar venta · Bike Trust</title>
<style>
  :root{--brasa:#E25822;--ink:#1d2433;--line:#e3e0da;}
  *{box-sizing:border-box} body{font-family:system-ui,'Segoe UI',sans-serif;color:var(--ink);background:#faf8f5;margin:0;padding:24px 16px}
  .card{max-width:520px;margin:0 auto;background:#fff;border:1px solid var(--line);border-radius:14px;padding:28px}
  h2{margin:0 0 4px} .sub{color:#777;font-size:14px;margin:0 0 22px}
  label{display:block;font-weight:600;font-size:14px;margin:18px 0 6px}
  select,input{width:100%;padding:10px 12px;font-size:15px;border:1px solid var(--line);border-radius:8px;background:#fff}
  .modo{display:flex;gap:10px;margin-top:6px}
  .modo label{flex:1;margin:0;border:1px solid var(--line);border-radius:8px;padding:10px;text-align:center;cursor:pointer;font-weight:500}
  .modo input{display:none} .modo label:has(input:checked){border-color:var(--brasa);background:#fdf1eb;color:var(--brasa)}
  button{width:100%;margin-top:24px;padding:13px;font-size:16px;font-weight:600;color:#fff;background:var(--brasa);border:none;border-radius:9px;cursor:pointer}
  button:disabled{opacity:.5;cursor:default}
  .oculto{display:none} .err{color:#b3261e;font-size:14px;margin-top:12px;white-space:pre-wrap}
  .ok{text-align:center;padding:16px 0} .ok h2{font-size:26px}
  .ok ul{text-align:left;line-height:1.9}
</style>
<body><div class="card" id="card">
<h2>💰 Registrar venta</h2>
<p class="sub">Un solo paso: deja el lead cerrado, el interés en Cerró y la bici Vendida.</p>
<form id="f">
  <label>Bici vendida</label>
  <select id="bici" required><option value="">— Elige la bici —</option>${biciOpts}</select>

  <label>¿El cliente venía agendado?</label>
  <div class="modo">
    <label><input type="radio" name="modo" value="lead" checked> Sí, es un lead</label>
    <label><input type="radio" name="modo" value="walkin"> No, llegó a la tienda</label>
  </div>

  <div id="g-lead">
    <label>Lead</label>
    <select id="lead"><option value="">— Elige el lead —</option>${leadOpts}</select>
  </div>
  <div id="g-walkin" class="oculto">
    <label>Nombre del cliente</label>
    <input id="nombre" placeholder="Nombre y apellido">
    <label>Teléfono (WhatsApp)</label>
    <input id="telefono" placeholder="+56 9 …">
  </div>

  <button id="btn" type="submit">Registrar la venta</button>
  <div class="err" id="err"></div>
</form>
</div>
<script>
const KEY=${JSON.stringify(key || '')};
const $=id=>document.getElementById(id);
document.querySelectorAll('input[name=modo]').forEach(r=>r.addEventListener('change',()=>{
  const lead=document.querySelector('input[name=modo]:checked').value==='lead';
  $('g-lead').classList.toggle('oculto',!lead);
  $('g-walkin').classList.toggle('oculto',lead);
}));
$('f').addEventListener('submit',async ev=>{
  ev.preventDefault(); $('err').textContent='';
  const modo=document.querySelector('input[name=modo]:checked').value;
  const body={bici:$('bici').value};
  if(!body.bici){$('err').textContent='Elige la bici.';return}
  if(modo==='lead'){
    body.lead=$('lead').value;
    if(!body.lead){$('err').textContent='Elige el lead (o marca "llegó a la tienda").';return}
  }else{
    body.nombre=$('nombre').value.trim(); body.telefono=$('telefono').value.trim();
    if(!body.nombre){$('err').textContent='Escribe el nombre del cliente.';return}
  }
  $('btn').disabled=true; $('btn').textContent='Registrando…';
  try{
    const r=await fetch(location.pathname+'?key='+encodeURIComponent(KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json();
    if(j.ok){
      document.getElementById('card').innerHTML='<div class="ok"><h2>✅ Venta registrada</h2><ul>'+
        '<li><b>Lead</b> cerrado con fecha'+(j.created&&j.created.lead?' (creado walk-in)':'')+'.</li>'+
        '<li><b>Interés</b> marcado Cerró'+(j.created&&j.created.interes?' (creado)':' (reusado)')+'.</li>'+
        '<li><b>Bici</b> marcada Vendida — sale del catálogo en la próxima publicación.</li>'+
        '</ul><p>Puedes cerrar esta pestaña.</p></div>';
    }else{ $('err').textContent='Error: '+(j.error||'desconocido'); $('btn').disabled=false; $('btn').textContent='Registrar la venta'; }
  }catch(e){ $('err').textContent='Error de red: '+e; $('btn').disabled=false; $('btn').textContent='Registrar la venta'; }
});
</script></body></html>`;
}

// GET → botón de Airtable (Open URL). Con ?form=1 (o sin parámetros de acción)
// sirve el FORMULARIO de venta única; con ?lead=/?bici= registra directo (botón
// de la Agenda, retrocompatible) y responde HTML legible.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return new Response('No autorizado', { status: 401 });
  const q = url.searchParams;
  if (q.get('form') === '1' || (!q.get('lead') && !q.get('bici') && !q.get('interes'))) {
    try {
      const html = await formHTML(env, q.get('key'));
      return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    } catch (e) {
      return new Response('Error: ' + (e && e.message || e), { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  }
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
