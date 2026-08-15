// Cloudflare Pages Function · POST /api/mc-lead
// Endpoint puente ManyChat → Airtable. Da de alta o "toca" un Lead identificado
// por su @handle de Instagram (el único dato estable que ManyChat tiene desde
// el primer contacto, antes de que el lead deje email/teléfono).
//
// Contrato (ver CLAUDE.md / PLAN_embudo.md — Día 3): todo lead que entra por
// el funnel de Instagram DEBE nacer aquí con `Fecha primer contacto`,
// `Estado` y `Canal origen` canónicos, o el reporte por período no lo cuenta.
//
// Lee con AIRTABLE_TOKEN, escribe con AIRTABLE_WRITE_TOKEN (igual que reservar.js).
// Protegido por env MC_KEY (?key=). Sin env → abierto (mismo criterio que
// recalcular-embudo/registrar-venta).

const JSONH = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSONH });

const BASE_DEFAULT = 'appQUgk8aeD752923';

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

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return reply({ error: 'unauthorized' }, 401);

  let data;
  try { data = await request.json(); }
  catch { return reply({ error: 'bad_json' }, 400); }

  const handle = String(data?.handle || '').trim().replace(/^@/, '');
  const canal  = String(data?.canal  || '').trim();
  const nombre = data?.nombre ? String(data.nombre).slice(0, 200) : '';
  const estado = data?.estado ? String(data.estado).trim() : 'nuevo';
  // 🔴 En WhatsApp NO existe `{{ig_username}}`: el único identificador estable es el
  // `subscriber_id` de ManyChat. Este endpoint es el PRIMER paso de la cascada, así que
  // sin esto la puerta de WhatsApp devolvía 422 en el nodo uno, no nacía ningún Lead, y
  // todo lo de abajo —ficha, teléfono, ticket— caía en `sin_lead` sin avisar.
  const subId = String(data?.subscriber_id || '').trim();
  if ((!handle && !subId) || !canal) {
    return reply({ error: 'missing_fields (handle o subscriber_id, y canal)' }, 422);
  }

  const BASE  = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ  = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  const WRITE = env.AIRTABLE_WRITE_TOKEN;
  const LEADS = env.AIRTABLE_LEADS_TABLE || 'Leads';
  if (!READ || !WRITE) return reply({ error: 'not_configured' }, 503);

  const api = (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`;
  const rH  = { Authorization: `Bearer ${READ}` };
  const wH  = { Authorization: `Bearer ${WRITE}`, 'Content-Type': 'application/json' };
  const now = new Date().toISOString();
  const lowerHandle = handle.toLowerCase().replace(/'/g, "\\'");

  // 1) Buscar por los DOS identificadores, en orden de fiabilidad.
  //
  // 🔴 Buscar solo por uno crea duplicados en el caso más común: alguien que comentó un
  // reel (nació con `@handle IG`) y semanas después aprieta el botón del sitio, llegando
  // por WhatsApp (trae `subscriber_id`). Mirando solo el subscriber_id no lo encuentra y
  // nace un SEGUNDO Lead de la misma persona — y con él se parte su historia en dos.
  let leadId = null, hadNombre = false, recFields = {};
  const escOne = (x) => String(x).replace(/'/g, "\\'");
  const formulas = [];
  if (subId)  formulas.push(`{MC subscriber id}='${escOne(subId)}'`);
  if (handle) formulas.push(`LOWER({@handle IG})='${lowerHandle}'`);
  let formula = formulas[0];

  try {
    for (const f of formulas) {
      const u = `${api(LEADS)}?maxRecords=1&filterByFormula=${encodeURIComponent(f)}`;
      const rr = await afetch(u, { headers: rH });
      if (!rr.ok) {
        if (rr.status === 404) continue;
        return reply({ error: 'airtable_read', status: rr.status, detail: await rr.text() }, 502);
      }
      const rec = ((await rr.json()).records || [])[0];
      if (rec) {
        leadId = rec.id; hadNombre = !!rec.fields.Nombre; recFields = rec.fields;
        formula = f;   // la que acertó — la reusa la resolución de carrera de abajo
        break;
      }
    }
  } catch {
    return reply({ error: 'network' }, 502);
  }

  // 2a) Ya existe: solo "tocamos" la interacción. NO pisamos Canal origen ni
  //     Estado (eso avanza vía /api/mc-evento) — Canal origen es el de origen real.
  if (leadId) {
    const fields = { 'Fecha última interacción': now };
    if (nombre && !hadNombre) fields['Nombre'] = nombre;   // enriquece si faltaba
    // Le pega el identificador del canal por el que llegó, si no lo tenía. Así la misma
    // persona en IG y en WhatsApp queda en UN registro. Nunca pisa uno que ya existía.
    if (subId  && !recFields['MC subscriber id']) fields['MC subscriber id'] = subId;
    if (handle && !recFields['@handle IG'])       fields['@handle IG'] = handle;
    const pr = await afetch(`${api(LEADS)}/${leadId}`, {
      method: 'PATCH', headers: wH,
      body: JSON.stringify({ typecast: true, fields }),
    });
    if (!pr.ok) return reply({ error: 'airtable_update', status: pr.status, detail: await pr.text() }, 502);
    return reply({ ok: true, leadId, created: false });
  }

  // 2b) No existe: nace el lead con el contrato completo.
  const cr = await afetch(api(LEADS), {
    method: 'POST', headers: wH,
    body: JSON.stringify({ typecast: true, fields: {
      ...(handle ? { '@handle IG': handle } : {}),
      ...(subId  ? { 'MC subscriber id': subId } : {}),
      ...(nombre ? { 'Nombre': nombre } : {}),
      'Canal origen': canal,
      'Estado': estado,
      'Fecha primer contacto': now,
      'Fecha última interacción': now,
    } }),
  });
  if (!cr.ok) return reply({ error: 'airtable_create', status: cr.status, detail: await cr.text() }, 502);
  const j = await cr.json();

  // 2c) AUTO-SANACIÓN de carrera: si dos requests simultáneos leyeron "no
  //     existe" antes de que el otro creara, quedan duplicados. Cada racer
  //     re-consulta: si hay más de un lead con el handle, TODOS convergen al
  //     más antiguo (createdTime, empate por id) y cada uno borra el registro
  //     que él mismo creó si no es el ganador. Best-effort: si esto falla, el
  //     lead creado igual es válido.
  try {
    const vu = `${api(LEADS)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=10`;
    const vr = await afetch(vu, { headers: rH });
    if (vr.ok) {
      const recs = ((await vr.json()).records || []);
      if (recs.length > 1) {
        recs.sort((a, b) => (a.createdTime < b.createdTime ? -1 : a.createdTime > b.createdTime ? 1 : a.id < b.id ? -1 : 1));
        const winner = recs[0];
        if (winner.id !== j.id) {
          await afetch(`${api(LEADS)}/${j.id}`, { method: 'DELETE', headers: wH });
          return reply({ ok: true, leadId: winner.id, created: false, dedup: 'race_resuelta' });
        }
      }
    }
  } catch { /* best-effort */ }

  return reply({ ok: true, leadId: j.id, created: true });
}
// Sólo POST. Pages responde 405 automáticamente a otros métodos en esta ruta.
