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
const SITE_DEFAULT = 'https://biketrust-sitio.pages.dev';

// slug idéntico al de build.mjs y mc-match: minúsculas, sin acentos, no-alfanum → '-'.
const slugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const clp = (n) => (n == null || n === '') ? '' : '$' + Number(n).toLocaleString('es-CL');

// Del "Desglose puntaje" saca el área con nota más baja: "Frenos 6,8 · Suspensión 5,9"
// o una por línea. Devuelve { area, nota, linea } — es el dato que abre el mensaje
// de honestidad ("dónde perdió puntos") sin que nadie tenga que redactarlo a mano.
function areaMasBaja(desglose) {
  const txt = String(desglose || '');
  if (!txt.trim()) return { area: '', nota: null, linea: '' };
  const partes = txt.split(/[\n·;|]+/).map(s => s.trim()).filter(Boolean);
  let best = null;
  for (const p of partes) {
    const m = /(\d+(?:[.,]\d+)?)\s*$|(\d+(?:[.,]\d+)?)\s*\/\s*7/.exec(p);
    if (!m) continue;
    const nota = parseFloat((m[1] || m[2]).replace(',', '.'));
    if (!isFinite(nota)) continue;
    const area = p.replace(/[:\-–]?\s*\d+(?:[.,]\d+)?\s*(\/\s*7)?\s*$/, '').replace(/[:\-–]\s*$/, '').trim();
    if (!best || nota < best.nota) best = { area, nota, linea: p };
  }
  return best || { area: '', nota: null, linea: '' };
}

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
  const INV   = env.AIRTABLE_INVENTARIO_TABLE || 'Inventario';
  const SITE  = (env.SITE_URL || SITE_DEFAULT).replace(/\/+$/, '');
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

  // 6) Devolver la BICI en campos PLANOS (mismo criterio que mc-match §2.1: la UI
  //    de ManyChat no lee bien rutas anidadas). Es lo que permite que el DM de la
  //    Puerta 1 muestre puntaje, dónde perdió puntos, estado honesto y ahorro sin
  //    que nadie los copie a mano. Best-effort: si falla, el evento igual quedó
  //    registrado y ManyChat cae a su copy genérico.
  let bici = {};
  if (biciId) {
    // Ojo: el GET de un registro único NO acepta ?fields[] (422). Se lee completo.
    const br = await afetch(`${api(INV)}/${biciId}`, { headers: rH });
    if (br.ok) {
      const f = (await br.json()).fields || {};
      const modelo = f.Modelo || f.Etiqueta || '';
      const talla = f.Talla || '';
      const precio = f.Precio ?? null;
      const precioNuevo = f['Precio nuevo'] ?? null;
      const ahorro = (precio != null && precioNuevo != null && precioNuevo > precio) ? precioNuevo - precio : null;
      const baja = areaMasBaja(f['Desglose puntaje']);
      const fotos = f['Fotos galería'];
      const foto = Array.isArray(fotos) && fotos[0] ? (fotos[0].thumbnails?.large?.url || fotos[0].url) : '';
      const esElectrica = String(f['Motorización'] || '').toLowerCase().startsWith('el');
      bici = {
        biciModelo: modelo,
        biciEtiqueta: f.Etiqueta || modelo,
        biciAnio: f['Año'] || '',
        biciTalla: talla || '',
        biciPrecio: clp(precio),
        biciPrecioNuevo: clp(precioNuevo),
        biciAhorro: clp(ahorro),
        biciPuntaje: f['Puntaje certificación'] != null ? String(f['Puntaje certificación']).replace('.', ',') : '',
        biciDesglose: f['Desglose puntaje'] || '',
        biciAreaBaja: baja.area,
        biciAreaBajaLinea: baja.linea,
        biciEstadoHonesto: f['Estado honesto'] || '',
        biciRangoAltura: f['Rango altura'] || '',
        biciPorQueAmarla: f['Por qué amarla'] || '',
        biciFoto: foto,
        biciFicha: `${SITE}/ficha/${slugify(`${modelo}-${talla}`)}`,
        // Estado real de la unidad: deja que ManyChat bifurque en vez de afirmar
        // "sigue disponible" sobre una bici ya vendida (el reel sigue circulando).
        biciEstado: f.Estado || '',
        // Como PALABRA, no booleano: el mapeo de ManyChat no guarda booleanos en
        // campos de texto — la condición C1a («es false» → bici vendida) nunca
        // habría disparado (bug gemelo del cf_match, cazado 2026-07-30).
        biciDisponible: f.Estado === 'Disponible' ? 'true' : 'false',
        // Solo e-bikes; en musculares van vacíos y ManyChat los omite.
        biciBateria: esElectrica && f['Diag · salud batería'] != null ? String(Math.round(f['Diag · salud batería'] * 100)) : '',
        biciCiclos: esElectrica && f['Diag · ciclos'] != null ? String(f['Diag · ciclos']) : '',
        biciKmMotor: esElectrica && f['Diag · km motor'] != null ? String(f['Diag · km motor']) : '',
      };
    }
  }

  return reply({
    ok: true, leadId, interesId, biciId: biciId || null,
    estadoActual: fieldsLead['Estado'] || estadoActual, estadoAplicado,
    ...bici,
  });
}
// Sólo POST. Pages responde 405 automáticamente a otros métodos en esta ruta.
