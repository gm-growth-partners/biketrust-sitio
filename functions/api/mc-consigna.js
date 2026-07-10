// Cloudflare Pages Function · POST /api/mc-consigna
// Rama "💰 Vender mi bici" de la Puerta 2 (DM). ManyChat captura los datos de la
// bici que el usuario quiere consignar y los manda acá: se crea un registro en la
// tabla Consignaciones (estado "Nueva") y se deja/actualiza el Lead con
// Canal origen = Consignación, para que la conversación quede trackeada. El
// contacto humano (un especialista responde) lo hace ManyChat asignando el chat a
// un agente — este endpoint solo persiste los datos.
//
// Body: { handle?, subscriber_id?, modelo, anio?, talla?, estadoBici?, precio?,
//         contacto?, fotos?, notas?, canal? }
//   - modelo es obligatorio; identidad por handle o subscriber_id.
//   - fotos: URL o array de URLs (best-effort; si Airtable no puede bajarlas no
//     rompe la consignación, se anota en Notas).
//
// Lead: upsert por @handle IG (dedup, contrato mc-lead). Si no existe y hay handle
// → nace con Canal='Consignación' (typecast crea la opción). Si existe → NO pisa
// su Canal/Estado (puede ser también comprador); solo toca última interacción.
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

// ── ManyChat helpers (mismo patrón que cron-recordatorios) ──────────────────
// Para el AVISO A LUIS: setCustomFieldByName(cf_consigna_datos) + sendFlow del
// flow de 1 nodo que envuelve la plantilla `nueva_consignacion` (Utility).
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

const num = (v) => {
  if (v == null || v === '') return null;
  const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

// fotos → array de {url} para adjuntos de Airtable (best-effort).
function fotosToAttach(v) {
  const arr = Array.isArray(v) ? v : (v ? String(v).split(/[\s,]+/) : []);
  return arr.map(s => String(s).trim()).filter(u => /^https?:\/\//i.test(u)).map(url => ({ url }));
}

const cfg = (env) => {
  const BASE = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  const WRITE = env.AIRTABLE_WRITE_TOKEN;
  return {
    BASE, READ, WRITE,
    LEADS: env.AIRTABLE_LEADS_TABLE || 'Leads',
    CONS: env.AIRTABLE_CONSIGNAS_TABLE || 'Consignaciones',
    api: (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`,
    rH: { Authorization: `Bearer ${READ}` },
    wH: { Authorization: `Bearer ${WRITE}`, 'Content-Type': 'application/json' },
    // Aviso al staff — se activa solo cuando token + flow + destinatarios existen.
    // Las ofertas van a ROBERTO (decisión reunión 2026-07-08); admite varios ids
    // separados por coma en AVISO_CONSIGNA_SIDS (fallback LUIS_SUBSCRIBER_ID).
    MC_TOKEN: env.MANYCHAT_TOKEN || '',
    FLOW_CONSIGNA: env.FLOW_NS_CONSIGNA || '',
    STAFF_SIDS: String(env.AVISO_CONSIGNA_SIDS || env.LUIS_SUBSCRIBER_ID || '')
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
  const modelo = data?.modelo ? String(data.modelo).trim().slice(0, 200) : '';
  const anio = num(data?.anio ?? data?.año);
  const talla = data?.talla ? String(data.talla).trim().slice(0, 40) : '';
  const estadoBici = data?.estadoBici ? String(data.estadoBici).slice(0, 2000) : '';
  const precio = num(data?.precio);
  const contacto = data?.contacto ? String(data.contacto).slice(0, 60) : '';
  const fotos = fotosToAttach(data?.fotos);
  const notas = data?.notas ? String(data.notas).slice(0, 2000) : '';
  const canal = String(data?.canal || 'Consignación').trim();

  if (!modelo) return reply({ error: 'missing_fields (modelo)' }, 422);
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

  // 2) Upsert del Lead. Nace con Canal='Consignación' (typecast crea la opción);
  //    si ya existe, NO se pisa Canal/Estado (puede ser comprador) — solo se toca
  //    la interacción y se completa WhatsApp si faltaba.
  let leadCreado = false;
  if (!leadId) {
    if (!handle) return reply({ error: 'lead_not_found (se necesita handle para crear el lead)' }, 404);
    const cr = await afetch(C.api(C.LEADS), {
      method: 'POST', headers: C.wH,
      body: JSON.stringify({ typecast: true, fields: {
        '@handle IG': handle,
        'Canal origen': canal,
        'Estado': 'nuevo',
        'Fecha primer contacto': now,
        'Fecha última interacción': now,
        ...(subId ? { 'MC subscriber id': subId } : {}),
        ...(contacto ? { 'WhatsApp': contacto } : {}),
      } }),
    });
    if (!cr.ok) return reply({ error: 'airtable_lead_create', status: cr.status, detail: await cr.text() }, 502);
    leadId = (await cr.json()).id; leadCreado = true;
  } else {
    const upd = { 'Fecha última interacción': now };
    if (subId && !leadFields?.['MC subscriber id']) upd['MC subscriber id'] = subId;
    if (contacto && !leadFields?.WhatsApp) upd['WhatsApp'] = contacto;
    const pr = await afetch(`${C.api(C.LEADS)}/${leadId}`, {
      method: 'PATCH', headers: C.wH,
      body: JSON.stringify({ typecast: true, fields: upd }),
    });
    if (!pr.ok) return reply({ error: 'airtable_lead_update', status: pr.status, detail: await pr.text() }, 502);
  }

  // 3) Crear la Consignación (estado "Nueva" → aparece en la cola del staff).
  const fields = {
    'Modelo': modelo,
    'Estado': 'Nueva',
    'Origen': 'Bot DM',
    'Fecha': today,
    'Lead': [leadId],
    ...(anio != null ? { 'Año': anio } : {}),
    ...(talla ? { 'Talla': talla } : {}),
    ...(estadoBici ? { 'Estado bici': estadoBici } : {}),
    ...(precio != null ? { 'Precio esperado': precio } : {}),
    ...(contacto ? { 'Contacto': contacto } : {}),
    ...(notas ? { 'Notas': notas } : {}),
    ...(fotos.length ? { 'Fotos': fotos } : {}),
  };

  let cr = await afetch(C.api(C.CONS), {
    method: 'POST', headers: C.wH,
    body: JSON.stringify({ typecast: true, fields }),
  });
  // Reintento sin Fotos: si Airtable no pudo bajar una URL de foto, no perdemos la
  // consignación — se guarda sin fotos y se anota para que el staff las pida.
  if (!cr.ok && fotos.length) {
    const { Fotos, ...noFotos } = fields;
    noFotos['Notas'] = [notas, '(fotos no adjuntadas: pedirlas en el chat)'].filter(Boolean).join(' ');
    cr = await afetch(C.api(C.CONS), {
      method: 'POST', headers: C.wH,
      body: JSON.stringify({ typecast: true, fields: noFotos }),
    });
  }
  if (!cr.ok) return reply({ error: 'airtable_consigna_create', status: cr.status, detail: await cr.text() }, 502);
  const consignaId = (await cr.json()).id;

  // 4) AVISO A LUIS por WhatsApp (best-effort: si falla, la consignación ya
  //    quedó creada — el staff igual la ve en la página de Consignaciones).
  //    Requiere plantilla `nueva_consignacion` aprobada por Meta + 3 env:
  //    MANYCHAT_TOKEN · FLOW_NS_CONSIGNA (flow de 1 nodo) · LUIS_SUBSCRIBER_ID.
  let aviso = 'no_configurado';
  if (C.MC_TOKEN && C.FLOW_CONSIGNA && C.STAFF_SIDS.length) {
    try {
      const resumen = [
        modelo + (anio != null ? ` ${anio}` : ''),
        talla ? `talla ${talla}` : '',
        precio != null ? `pide $${Number(precio).toLocaleString('es-CL')}` : '',
        estadoBici ? estadoBici.slice(0, 150) : '',
        `contacto: ${contacto || 'sin teléfono'}`,
        handle ? `IG @${handle}` : '',
      ].filter(Boolean).join(' · ');
      let enviados = 0, dormidos = 0;
      for (const sid of C.STAFF_SIDS) {
        if (!horarioOk(env, sid)) { dormidos++; continue; }
        await mcSetField(C.MC_TOKEN, sid, 'cf_consigna_datos', resumen.slice(0, 900));
        await mcSendFlow(C.MC_TOKEN, sid, C.FLOW_CONSIGNA);
        enviados++;
      }
      aviso = enviados ? 'enviado' + (dormidos ? ` (${dormidos} fuera de horario)` : '') : 'fuera_de_horario';
    } catch (e) {
      aviso = 'error: ' + String(e && e.message || e).slice(0, 200);
    }
  }

  return reply({ ok: true, consignaId, leadId, leadCreado, aviso });
}
// Sólo POST. Pages responde 405 automáticamente a otros métodos en esta ruta.
