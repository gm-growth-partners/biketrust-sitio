// Cloudflare Pages Function · GET/POST /api/mc-agenda
// Etapa 4 del embudo (Agenda en el chat). ManyChat, dentro de la ventana de 24h
// del DM de Instagram, captura el horario elegido + teléfono + opt-in de WhatsApp
// y lo manda acá. Este endpoint deja el lead listo para el tramo automatizado por
// WhatsApp (confirmación/recordatorios).
//
//   - Lead    → Fecha visita + WhatsApp + Opt-in WhatsApp + Fecha opt-in +
//               Estado=visita_agendada (con guarda de no-regresión) + últ. interacción
//   - Interés → reusa el par lead↔bici (el de la ficha) y lo pasa a Resultado=Agendó;
//               si no existe, lo crea. No duplica filas (mismo criterio que registrar-venta).
//
// Resuelve la bici: `bici` directo → vía el reel comentado (`reel`→Reels.Bici) →
// fallback al Interés más reciente del lead que tenga bici.
//
// GET (opcional, selector del chat): devuelve 2 horarios A/B dinámicos (próximo
// sábado AM / próximo día hábil PM). NO chequea disponibilidad real todavía — para
// el volumen del showroom sobra; es la psicología "sábado AM o viernes PM".
//
// Lee con AIRTABLE_TOKEN, escribe con AIRTABLE_WRITE_TOKEN. Protegido por env
// MC_KEY (?key=). Sin env → abierto (mismo criterio que los otros puentes ManyChat).

const JSONH = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSONH });

const BASE_DEFAULT = 'appQUgk8aeD752923';

// Orden de la máquina de estados (idéntico a mc-evento). 99 = terminal.
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

// Combina fecha (YYYY-MM-DD) + hora (HH:MM) al formato dateTime naive que ya usa
// reservar.js. Si `fecha` ya trae 'T' (ISO completo), se respeta tal cual.
function fechaVisitaDe(fecha, hora) {
  const f = String(fecha || '').trim();
  if (!f) return null;
  if (f.includes('T')) return f;
  const h = String(hora || '').trim();
  return h ? `${f.slice(0, 10)}T${h.slice(0, 5)}:00` : `${f.slice(0, 10)}T12:00:00`;
}

// Fecha legible en español a partir del naive `YYYY-MM-DDTHH:MM:00` (que ya es
// hora de Chile). Se formatea en UTC para que el reloj de pared no se corra.
// La usa la confirmación inmediata de ManyChat (cf_fecha_visita). → "sábado, 10 de julio, 11:00".
function fechaVisitaLegibleDe(naive) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(naive || ''));
  if (!m) return String(naive || '');
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  const fecha = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long',
  }).format(d);
  return `${fecha}, ${m[4]}:${m[5]}`;
}

// Los 2 horarios A/B dinámicos, calculados en hora Chile (UTC-4). Fuente única
// que comparten el GET (pinta el selector) y el POST (resuelve `slot`), para que
// los botones de ManyChat NUNCA haya que editar aunque roten las semanas.
//   A = próximo sábado 11:00 · B = próximo viernes 18:00.
function slotsAB() {
  const nowCL = new Date(Date.now() - 4 * 3600 * 1000);
  const y = nowCL.getUTCFullYear(), mo = nowCL.getUTCMonth(), d = nowCL.getUTCDate();
  const dow = nowCL.getUTCDay(); // 0=Dom … 6=Sáb
  const proximo = (targetDow, hora) => {
    let delta = (targetDow - dow + 7) % 7;
    if (delta === 0) delta = 7; // siempre el próximo, no hoy
    const fecha = new Date(Date.UTC(y, mo, d + delta)).toISOString().slice(0, 10);
    return { fecha, hora, fechaVisita: `${fecha}T${hora}:00` };
  };
  const nombreDia = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const A = proximo(6, '11:00'), B = proximo(5, '18:00');
  const fmt = (wd, s) => `${nombreDia[wd]} ${s.fecha.slice(8, 10)}, ${s.hora}`;
  return [
    { id: 'A', label: fmt(6, A), ...A },
    { id: 'B', label: fmt(5, B), ...B },
  ];
}

const cfg = (env) => {
  const BASE  = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ  = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  const WRITE = env.AIRTABLE_WRITE_TOKEN;
  return {
    BASE, READ, WRITE,
    LEADS: env.AIRTABLE_LEADS_TABLE || 'Leads',
    INTER: env.AIRTABLE_INTERESES_TABLE || 'Intereses',
    REELS: env.AIRTABLE_REELS_TABLE || 'Reels',
    api: (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`,
    rH: { Authorization: `Bearer ${READ}` },
    wH: { Authorization: `Bearer ${WRITE}`, 'Content-Type': 'application/json' },
  };
};

// ───────────────────────────────────────────────────────────────────────────
// POST — agenda la visita.
// ───────────────────────────────────────────────────────────────────────────
export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return reply({ error: 'unauthorized' }, 401);

  let data;
  try { data = await request.json(); }
  catch { return reply({ error: 'bad_json' }, 400); }

  const handle    = data?.handle ? String(data.handle).trim().replace(/^@/, '') : '';
  const leadIn    = data?.lead ? String(data.lead).trim() : '';
  const telefono  = data?.telefono ? String(data.telefono).slice(0, 60) : '';
  const optin     = data?.optin === true || data?.optin === 1 || data?.optin === '1' || String(data?.optin).toLowerCase() === 'true';
  const reel      = data?.reel ? String(data.reel).trim() : '';
  const biciIn    = data?.bici ? String(data.bici).trim() : '';
  const origen    = String(data?.origen || 'Puerta 1 (reel/comentario)').trim();
  const resultado = String(data?.resultado || 'Agendó').trim();
  const slot      = data?.slot ? String(data.slot).trim().toUpperCase() : '';
  const subId     = data?.subscriber_id ? String(data.subscriber_id).trim() : ''; // id de ManyChat, para la Fase 3

  // fecha/hora explícitos mandan; si no, se resuelve por `slot` (A/B) server-side.
  let fechaVisita = fechaVisitaDe(data?.fecha, data?.hora);
  if (!fechaVisita && slot) fechaVisita = slotsAB().find(s => s.id === slot)?.fechaVisita || null;

  if (!leadIn && !handle && !subId) return reply({ error: 'missing_fields (lead, handle o subscriber_id)' }, 422);
  if (!fechaVisita) return reply({ error: 'missing_fields (fecha [+hora] o slot A/B)' }, 422);

  const C = cfg(env);
  if (!C.READ || !C.WRITE) return reply({ error: 'not_configured' }, 503);
  const now = new Date().toISOString();
  const today = new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10); // Chile UTC-4

  // 1) Resolver el Lead: id directo → @handle IG → MC subscriber id.
  //    El subscriber_id es la vía fiable cuando el reagendo llega por WhatsApp
  //    (ahí el @handle de IG puede venir vacío). Se guardó en la agenda.
  const findLead = async (formula) => {
    const u = `${C.api(C.LEADS)}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;
    const rr = await afetch(u, { headers: C.rH });
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

  // 2) Leer el Lead completo (Estado actual + sus Intereses).
  const lr = await afetch(`${C.api(C.LEADS)}/${leadId}`, { headers: C.rH });
  if (!lr.ok) return reply({ error: 'lead_not_found', status: lr.status }, 404);
  const leadFields = (await lr.json()).fields || {};
  const estadoActual = leadFields.Estado || 'nuevo';

  // 3) Cargar UNA vez los Intereses del lead (sirve para el fallback de bici y
  //    para encontrar el par lead↔bici a reusar).
  const interesIds = linkIds(leadFields.Intereses);
  const interesesLead = [];
  for (const id of interesIds) {
    const ir = await afetch(`${C.api(C.INTER)}/${id}`, { headers: C.rH });
    if (ir.ok) interesesLead.push({ id, bici: linkIds((await ir.json()).fields?.Bici) });
  }

  // 4) Resolver la bici: directo → reel (Reels.Bici) → último Interés con bici.
  let biciId = biciIn, reelId = null;
  if (!biciId && reel) {
    const u = `${C.api(C.REELS)}?maxRecords=1&filterByFormula=${encodeURIComponent(`{Post ID Instagram}='${reel.replace(/'/g, "\\'")}'`)}`;
    const rr = await afetch(u, { headers: C.rH });
    if (rr.ok) {
      const rec = (await rr.json()).records?.[0];
      if (rec) { reelId = rec.id; biciId = linkIds(rec.fields.Bici)[0] || ''; }
    }
  }
  if (!biciId) {
    for (let i = interesesLead.length - 1; i >= 0; i--) {
      if (interesesLead[i].bici[0]) { biciId = interesesLead[i].bici[0]; break; }
    }
  }

  // 4b) Nombre del modelo (para cf_bici de las plantillas de WhatsApp).
  let biciNombre = '';
  if (biciId) {
    const br = await afetch(`${C.api('Inventario')}/${biciId}`, { headers: C.rH });
    if (br.ok) { const bf = (await br.json()).fields || {}; biciNombre = bf.Modelo || bf.Etiqueta || ''; }
  }
  const fechaVisitaLegible = fechaVisitaLegibleDe(fechaVisita);

  // ¿Cuántas horas faltan para la visita? (naive = hora Chile; se compara contra
  // "ahora en Chile" con el mismo criterio -4 que el resto del código.)
  const horasHasta = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(fechaVisita));
    if (!m) return Infinity;
    const visit = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    return (visit - (Date.now() - 4 * 3600 * 1000)) / 3600000;
  })();

  // 5) Lead → datos de agenda + opt-in + Estado (con guarda de no-regresión).
  //    Se resetean los flags de recordatorio (si es un reagendo, el motor debe
  //    volver a mandar para la nueva fecha). Excepción: si agenda con < 47h de
  //    anticipación, la confirmación inmediata ya cubre el aviso "de 48h" → se
  //    marca ese recordatorio como enviado para NO mandar dos mensajes seguidos.
  const suprime48 = horasHasta < 47;
  const fieldsLead = {
    'Fecha visita': fechaVisita,
    'Fecha última interacción': now,
    'Recordatorio 48h': suprime48 ? now : null,
    'Recordatorio 8am': null,
    'Recordatorio 2h': null,
  };
  if (telefono) fieldsLead['WhatsApp'] = telefono;
  if (optin) { fieldsLead['Opt-in WhatsApp'] = true; fieldsLead['Fecha opt-in'] = today; }
  if (subId) fieldsLead['MC subscriber id'] = subId;
  if (biciNombre) fieldsLead['MC bici'] = biciNombre;

  let estadoAplicado = false;
  const rangoNuevo = RANGO['visita_agendada'];
  const rangoActual = estadoActual in RANGO ? RANGO[estadoActual] : 0;
  if (rangoNuevo >= rangoActual) { fieldsLead['Estado'] = 'visita_agendada'; estadoAplicado = true; }

  const lp = await afetch(`${C.api(C.LEADS)}/${leadId}`, {
    method: 'PATCH', headers: C.wH,
    body: JSON.stringify({ typecast: true, fields: fieldsLead }),
  });
  if (!lp.ok) return reply({ error: 'airtable_update', status: lp.status, detail: await lp.text() }, 502);

  // 6) Interés lead↔bici: reusar el existente (→ Agendó) o crear uno nuevo.
  let interesId = null, interesCreado = false;
  if (biciId) interesId = interesesLead.find(x => x.bici.includes(biciId))?.id || null;

  if (interesId) {
    const pr = await afetch(`${C.api(C.INTER)}/${interesId}`, {
      method: 'PATCH', headers: C.wH,
      body: JSON.stringify({ typecast: true, fields: { 'Resultado': resultado, 'Fecha': today } }),
    });
    if (!pr.ok) return reply({ error: 'airtable_interes_update', status: pr.status, detail: await pr.text() }, 502);
  } else {
    const cr = await afetch(C.api(C.INTER), {
      method: 'POST', headers: C.wH,
      body: JSON.stringify({ typecast: true, fields: {
        'Lead': [leadId],
        ...(biciId ? { 'Bici': [biciId] } : {}),
        ...(reelId ? { 'Reel': [reelId] } : {}),
        'Origen': origen,
        'Resultado': resultado,
        'Fecha': today,
      } }),
    });
    if (!cr.ok) return reply({ error: 'airtable_interes_create', status: cr.status, detail: await cr.text() }, 502);
    interesId = (await cr.json()).id; interesCreado = true;
  }

  return reply({
    ok: true, leadId, interesId, interesCreado, biciId: biciId || null,
    biciNombre: biciNombre || null, fechaVisitaLegible,
    slot: slot || null, fechaVisita, estadoActual: fieldsLead['Estado'] || estadoActual, estadoAplicado,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// GET — selector de horarios A/B dinámico para el chat (no chequea calendario).
//   ?key= (si MC_KEY) . Responde { ok, slots:[{id, label, fecha, hora, fechaVisita}] }.
// ───────────────────────────────────────────────────────────────────────────
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return reply({ error: 'unauthorized' }, 401);
  return reply({ ok: true, slots: slotsAB() });
}
