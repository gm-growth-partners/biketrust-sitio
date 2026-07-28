// Cloudflare Pages Function · POST /api/mc-llamado
// Ticket de LLAMADO para leads de región (Puerta 2). Cuando la persona no está
// en Santiago, en vez de agendar una visita al showroom se agenda una llamada:
// el bot captura ciudad + franja preferida + teléfono, crea el ticket en la
// tabla `Llamados` (Estado=Llamada pendiente) y avisa al staff por WhatsApp
// para que llame. La bici de interés viaja como dato: `bici` (record id, viene
// de cf_hero_bici en Puerta 2) o `reel` (Post ID Instagram, Puerta 1 → se
// resuelve vía Reels.Bici, igual que mc-evento/mc-agenda).
//
// Body: { handle?, subscriber_id?, telefono?, optin?, ciudad?, franja?, bici?, reel?, notas? }
//   - Identidad por handle o subscriber_id (el lead normalmente ya existe).
//   - IMPORTANTE: un llamado NO escribe `Fecha visita` en el Lead (eso activaría
//     los recordatorios de visita del motor cron). El ciclo del llamado vive en
//     su tarjeta: Nueva → Llamado → Cerrada.
//
//   - Llamado → Nombre (del lead), Teléfono, Ciudad, Franja, Bici de interés,
//               Estado=Llamada pendiente, Origen=Bot DM, Fecha, Notas, link Lead.
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

// ── Horarios de aviso por destinatario ───────────────────────────────────────
// ⚠️ ESTE HELPER ESTÁ DUPLICADO en `cron-briefing.js`. Si cambias uno, cambia el otro.
//
// Formato de `AVISO_HORARIOS`: `sid:DIAS@desde-hasta`, separados por coma.
//   DIAS = dígitos de los días en que SÍ se avisa (0=domingo … 6=sábado).
//   También acepta el formato antiguo `D-D@H-H` (rango contiguo) por compatibilidad.
//
// Cobertura real del negocio (2026-07-27):
//   Luis    → lunes, miércoles, jueves, viernes, sábado  (NO martes ni domingo)
//   Roberto → todos los días, y además cubre el martes
// La ventana empieza a la hora del briefing: antes de eso el aviso inmediato no
// hace falta porque el briefing matutino ya lista la cola completa del día.
const HORARIOS_DEFAULT = '579628082:13456@9-20,302195575:0123456@9-20';
// `ignorarHora` lo usa el briefing: SU hora la gobierna BRIEFING_HOUR, y aplicarle
// además esta ventana lo bloquearía a sí mismo si alguien lo mueve a las 8:00.
function horarioOk(env, sid, now = new Date(), ignorarHora = false) {
  const entry = String(env.AVISO_HORARIOS || HORARIOS_DEFAULT)
    .split(',').map(s => s.trim()).find(s => s.startsWith(String(sid) + ':'));
  if (!entry) return true;
  const m = /^([\d-]+)@(\d{1,2})-(\d{1,2})$/.exec(entry.slice(entry.indexOf(':') + 1));
  if (!m) return true;
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', hour: 'numeric', hour12: false, weekday: 'short' }).formatToParts(now);
  const hora = Number(p.find(x => x.type === 'hour').value);
  const dia = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.find(x => x.type === 'weekday').value];
  if (!ignorarHora && (hora < Number(m[2]) || hora >= Number(m[3]))) return false;
  if (m[1].includes('-')) { const [a, b] = m[1].split('-').map(Number); return dia >= a && dia <= b; }
  return m[1].includes(String(dia));
}

// ── Horario del especialista y promesa de llamada ────────────────────────────
// El bot NO puede prometer «te llamamos al tiro» a las 2 AM ni un sábado a las
// 19:00: una promesa incumplida hace más daño que no haberla hecho. Este helper
// calcula la promesa REAL y `mc-llamado` la devuelve lista para que ManyChat la
// imprima. Así el horario vive en UN solo lugar y cambiarlo es editar una env,
// no tocar código ni los flujos de ManyChat.
//
// Formato de `HORARIO_ESPECIALISTA`: bloques `dia@desde-hasta` separados por `|`.
// Día: 0=domingo … 6=sábado. Un día ausente = nadie atiende ese día.
//
// ⚠️ Este es el horario del NEGOCIO, no el de una persona: lo que importa para la
// promesa es si ALGUIEN va a llamar, no quién. Al 2026-07-27 la cobertura es
// Luis de lunes a sábado salvo el martes, y **Roberto cubre el martes** — por eso
// el martes está abierto acá aunque Luis no trabaje (y por eso un lead del lunes
// por la noche se llama el martes, no el miércoles).
// Domingo cerrado: nadie declaró cobertura. Si Roberto también atiende domingos,
// agregar `|0@10-20` a la env y la promesa se ajusta sola.
const HORARIO_DEFAULT = '1@10-20|2@10-20|3@10-20|4@10-20|5@10-20|6@10-15';
const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function parseHorario(env) {
  const out = {};
  for (const bloque of String(env.HORARIO_ESPECIALISTA || HORARIO_DEFAULT).split('|')) {
    const m = /^(\d)@(\d{1,2})-(\d{1,2})$/.exec(bloque.trim());
    if (m) out[Number(m[1])] = [Number(m[2]), Number(m[3])];
  }
  return out;
}

// → { abierto, promesa } · `promesa` es el texto literal para el DM de confirmación.
function promesaLlamada(env, now = new Date()) {
  const H = parseHorario(env);
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', hour: 'numeric', hour12: false, weekday: 'short' }).formatToParts(now);
  const hora = Number(p.find(x => x.type === 'hour').value);
  const hoy = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.find(x => x.type === 'weekday').value];

  const hoyH = H[hoy];
  if (hoyH && hora >= hoyH[0] && hora < hoyH[1]) return { abierto: true, promesa: 'en los próximos minutos' };
  if (hoyH && hora < hoyH[0]) return { abierto: false, promesa: `hoy a partir de las ${hoyH[0]}:00` };
  for (let i = 1; i <= 7; i++) {
    const d = (hoy + i) % 7;
    if (H[d]) return { abierto: false, promesa: `${i === 1 ? 'mañana' : 'el ' + DIAS_SEMANA[d]} a partir de las ${H[d][0]}:00` };
  }
  return { abierto: false, promesa: 'apenas abramos' };
}

// Texto limpio: recorta y descarta merge tags sin resolver ({{cuf_…}}).
const clean = (v, max = 200) => {
  const s = v == null ? '' : String(v).trim();
  return s.includes('{{') ? '' : s.slice(0, max);
};

const p2 = (n) => String(n).padStart(2, '0');
const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

// Día preferido para el llamado (`dia`): quick reply del bot ('lo antes posible',
// 'hoy', 'mañana', 'lunes'…'sábado') o fecha explícita ('YYYY-MM-DD', 'DD/MM/YYYY').
// Se resuelve a una fecha en hora Chile → campo `Llamar el` del ticket. El staff
// no llama en domingo → un domingo se corre al lunes. Sin `dia` → campo vacío
// (comportamiento previo: se llama lo antes posible).
function resolverDia(v) {
  const s = sinAcentos(clean(v, 40));
  if (!s) return null;
  const hoyCL = new Date(Date.now() - 4 * 3600 * 1000);
  const mas = (n) => new Date(hoyCL.getTime() + n * 86400 * 1000);
  const fecha = (d) => d.toISOString().slice(0, 10);
  let out = null, m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) out = `${m[1]}-${p2(m[2])}-${p2(m[3])}`;
  else if ((m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/.exec(s))) out = `${m[3]}-${p2(m[2])}-${p2(m[1])}`;
  else if (/antes posible|cuanto antes|asap/.test(s) || /^hoy/.test(s)) out = fecha(hoyCL);
  else if (/^manana/.test(s)) out = fecha(mas(1));
  else {
    const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const idx = DIAS.findIndex(d => s.startsWith(d));
    if (idx >= 0) out = fecha(mas((idx - hoyCL.getUTCDay() + 7) % 7)); // 0 = hoy mismo
  }
  if (!out) return null;
  // domingo → lunes
  const dow = new Date(out + 'T00:00:00Z').getUTCDay();
  if (dow === 0) out = fecha(new Date(Date.parse(out + 'T00:00:00Z') + 86400 * 1000));
  return out;
}

// "2026-07-21" → "lunes 21 de julio" (para el resumen del aviso al staff).
function diaLegible(f) {
  const d = new Date(f + 'T12:00:00Z');
  if (isNaN(d)) return f;
  return new Intl.DateTimeFormat('es-CL', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(d);
}

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
    REELS: env.AIRTABLE_REELS_TABLE || 'Reels',
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
  // Franja: los botones de ManyChat traen la hora ("Mañana 11:00") — se normaliza
  // al valor canónico del select (Mañana/Tarde) para no crear opciones basura.
  const franjaRaw = clean(data?.franja, 40);
  const franja = /^ma[ñn]ana/i.test(franjaRaw) ? 'Mañana'
    : /^tarde/i.test(franjaRaw) ? 'Tarde' : franjaRaw;
  const biciIn = clean(data?.bici, 40);
  const reel = clean(data?.reel, 80);
  const notas = clean(data?.notas, 2000);
  // Día preferido para el llamado (quick reply o fecha del picker) → `Llamar el`.
  const llamarEl = resolverDia(data?.dia || data?.fechaLlamado);

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
  // ETAPA «teléfono» del embudo V2 — la métrica #1 del negocio (% de leads que
  // entregan su número). Se sella UNA sola vez: si el lead vuelve por otro reel,
  // la fecha original no se pisa, para no falsear la cohorte de la semana.
  // La bandera `Llegó a teléfono` deriva de este campo por fórmula.
  if (telefono && !leadFields?.['Fecha teléfono']) upd['Fecha teléfono'] = now;
  const lp = await afetch(`${C.api(C.LEADS)}/${leadId}`, {
    method: 'PATCH', headers: C.wH,
    body: JSON.stringify({ typecast: true, fields: upd }),
  });
  if (!lp.ok) return reply({ error: 'airtable_lead_update', status: lp.status, detail: await lp.text() }, 502);

  // 2b) Resolver la bici de interés: `bici` directo (Puerta 2, cf_hero_bici) →
  //     `reel` (Puerta 1, Post ID Instagram → Reels.Bici). Best-effort: sin
  //     bici el ticket igual se crea.
  let biciId = biciIn;
  if (!biciId && reel) {
    const u = `${C.api(C.REELS)}?maxRecords=1&filterByFormula=${encodeURIComponent(`{Post ID Instagram}='${reel.replace(/'/g, "\\'")}'`)}`;
    const rr = await afetch(u, { headers: C.rH });
    if (rr.ok) {
      const rec = (await rr.json()).records?.[0];
      const link = rec?.fields?.Bici;
      biciId = (Array.isArray(link) ? link[0] : link) || '';
    }
  }

  // 2b-bis) Nombre del modelo (lo usan el dedup y el resumen del aviso).
  let biciNombre = '';
  if (biciId) {
    const br = await afetch(`${C.api('Inventario')}/${biciId}`, { headers: C.rH });
    if (br.ok) { const bf = (await br.json()).fields || {}; biciNombre = bf.Modelo || bf.Etiqueta || ''; }
  }

  // 2c) DEDUP: ¿este lead ya tiene un llamado abierto? El comprador más caliente
  //      es justo el que comenta en dos o tres reels y deja el teléfono en cada
  //      uno. Sin esto, Luis ve tres filas del mismo nombre: o llama tres veces
  //      (queda como spam) o llama una y las otras dos ensucian la cola y la
  //      métrica de «nunca llamados». Se agrega el interés nuevo al ticket vivo.
  let abierto = null;
  try {
    const fu = `${C.api(C.LLAM)}?pageSize=50&filterByFormula=${encodeURIComponent(`{Estado}='Llamada pendiente'`)}`;
    const fr = await afetch(fu, { headers: C.rH });
    if (fr.ok) {
      const recs = (await fr.json()).records || [];
      abierto = recs.find(r => (r.fields?.Lead || []).some(x => (typeof x === 'string' ? x : x?.id) === leadId)) || null;
    }
  } catch { /* best-effort: si falla la búsqueda, se crea uno nuevo */ }

  if (abierto) {
    const extra = [
      abierto.fields?.Notas || '',
      `+ ${today}: también preguntó por ${biciNombre || 'otra bici'}${notas ? ' · ' + notas : ''}`,
    ].filter(Boolean).join('\n');
    const pr = await afetch(`${C.api(C.LLAM)}/${abierto.id}`, {
      method: 'PATCH', headers: C.wH,
      body: JSON.stringify({ typecast: true, fields: {
        'Notas': extra.slice(0, 2000),
        ...(telefono && !abierto.fields?.['Teléfono'] ? { 'Teléfono': telefono } : {}),
      } }),
    });
    if (pr.ok) {
      return reply({ ok: true, llamadoId: abierto.id, leadId, leadCreado, dedup: true,
        biciNombre: biciNombre || null, llamarEl: null, llamarElLegible: null, aviso: 'omitido_ticket_abierto' });
    }
    // si el PATCH falla, cae al camino normal y crea uno nuevo
  }

  // 3) Crear el TICKET de llamado (Estado=Llamada pendiente → cola del staff).
  const nombre = leadFields?.Nombre || (handle ? '@' + handle : 'Lead de región');
  const lr = await afetch(C.api(C.LLAM), {
    method: 'POST', headers: C.wH,
    body: JSON.stringify({ typecast: true, fields: {
      'Nombre': nombre,
      'Estado': 'Llamada pendiente',
      'Origen': 'Bot DM',
      'Fecha': today,
      'Lead': [leadId],
      ...(telefono ? { 'Teléfono': telefono } : {}),
      ...(ciudad ? { 'Ciudad': ciudad } : {}),
      ...(franja ? { 'Franja': franja } : {}),
      ...(llamarEl ? { 'Llamar el': llamarEl } : {}),
      ...(biciId ? { 'Bici de interés': [biciId] } : {}),
      ...(notas ? { 'Notas': notas } : {}),
    } }),
  });
  if (!lr.ok) return reply({ error: 'airtable_llamado_create', status: lr.status, detail: await lr.text() }, 502);
  const llamadoId = (await lr.json()).id;

  // 4) AVISO AL STAFF por WhatsApp (best-effort; el ticket ya quedó creado).
  // La promesa se calcula UNA vez y se usa en dos lados: en el resumen que le
  // llega al staff y en la respuesta que ManyChat imprime al lead. Así los dos
  // ven exactamente el mismo compromiso.
  const pl = promesaLlamada(env);

  let aviso = 'no_configurado';
  if (C.MC_TOKEN && C.FLOW_LLAMADO && C.STAFF_SIDS.length) {
    try {
      // ⚠️ En V2 NO hay franja horaria: al lead no se le pregunta cuándo prefiere
      // que lo llamen — deja su número y se le llama lo antes posible dentro del
      // horario. Por eso el resumen NO la incluye. La plantilla `nuevo_llamado`
      // todavía cierra con «contacta en la franja indicada»: esa frase quedó
      // obsoleta y hay que reemplazarla (ver docs/V2_SALIDAS_LLAMADA.md).
      // `llamarEl` sobrevive solo para tickets creados a mano por el staff.
      const resumen = [
        nombre,
        ciudad ? `de ${ciudad}` : '',
        biciNombre ? `interesado en ${biciNombre}` : '',
        telefono || 'sin teléfono',
        ...(llamarEl ? [`pidió que lo llamen el ${diaLegible(llamarEl)}`] : []),
      ].filter(Boolean).join(' · ');
      let enviados = 0, dormidos = 0;
      for (const sid of C.STAFF_SIDS) {
        if (!horarioOk(env, sid)) { dormidos++; continue; }
        await mcSetField(C.MC_TOKEN, sid, 'cf_llamado_datos', resumen.slice(0, 900));
        await mcSendFlow(C.MC_TOKEN, sid, C.FLOW_LLAMADO);
        enviados++;
      }
      aviso = enviados ? 'enviado' + (dormidos ? ` (${dormidos} fuera de horario)` : '') : 'fuera_de_horario';
    } catch (e) {
      aviso = 'error: ' + String(e && e.message || e).slice(0, 200);
    }
  }

  // `promesaLlamada` va lista para que ManyChat la imprima en la confirmación:
  //   «Luis te llama {{promesaLlamada}} desde el +56 9 XXXX XXXX.»
  // Nunca promete lo que el horario no permite. Se ajusta con HORARIO_ESPECIALISTA.
  return reply({ ok: true, llamadoId, leadId, leadCreado, biciNombre: biciNombre || null, llamarEl: llamarEl || null, llamarElLegible: llamarEl ? diaLegible(llamarEl) : null, aviso, promesaLlamada: pl.promesa, dentroDeHorario: pl.abierto });
}
// Sólo POST. Pages responde 405 automáticamente a otros métodos en esta ruta.
