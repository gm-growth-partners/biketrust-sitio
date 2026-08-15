// Cloudflare Pages Function · POST /api/mc-acepta
//
// Sella el momento en que la persona dice que SÍ a «¿quieres que un experto te
// llame?». Es la etapa que faltaba en la cadena de la puerta web: entre recibir
// la ficha y entregar el número hay gente que acepta la llamada y aun así no deja
// el teléfono. Sin este sello esa fuga es invisible.
//
// 🔴 POR QUÉ NO ES UN ESTADO NUEVO NI VA DENTRO DE `mc-evento`.
// `Leads.Estado` es UN valor único y mutable: puede retroceder, y las banderas que
// derivan de él mienten cuando el lead avanza por un camino que no es la escalera
// (es el bug de fondo documentado en la cabecera de `tablero/src/embudo.mjs`). El
// sistema ya tiene el idioma correcto para un hito: `Fecha teléfono` es un campo
// con fecha que se sella UNA vez, y `Llegó a teléfono` deriva de él por fórmula.
// Acá se hace igual, con `Fecha aceptó llamada` + `Aceptó llamada`. Este endpoint
// **NO toca `Estado`** — a propósito, para no poder romper la máquina de 13 estados.
//
// Se separó de `mc-evento` porque ese endpoint ES la máquina de estados y hoy rutea
// conversaciones en vivo: meterle un evento que no es un estado lo vuelve ambiguo y
// arriesga el camino que ya funciona.
//
// Lee con AIRTABLE_TOKEN, escribe con AIRTABLE_WRITE_TOKEN. Protegido por MC_KEY.

const JSONH = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSONH });

const BASE_DEFAULT = 'appQUgk8aeD752923';

async function afetch(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, opts);
    if (r.status !== 429 || i >= tries - 1) return r;
    await new Promise((res) => setTimeout(res, 1200 * (i + 1)));
  }
}

const keyOk = (env, url) => (env.MC_KEY ? url.searchParams.get('key') === env.MC_KEY : true);

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return reply({ error: 'unauthorized' }, 401);

  let data;
  try { data = await request.json(); }
  catch { return reply({ error: 'bad_json' }, 400); }

  const handle = String(data?.handle || '').trim().replace(/^@/, '');
  if (!handle) return reply({ error: 'missing_fields (handle)' }, 422);

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

  // 1) El lead por @handle IG, el identificador de dedup del funnel.
  let lead = null;
  try {
    const u = `${api(LEADS)}?maxRecords=1&filterByFormula=${encodeURIComponent(`LOWER({@handle IG})='${lowerHandle}'`)}`;
    const rr = await afetch(u, { headers: rH });
    if (!rr.ok && rr.status !== 404) {
      return reply({ error: 'airtable_read', status: rr.status, detail: await rr.text() }, 502);
    }
    if (rr.ok) lead = ((await rr.json()).records || [])[0] || null;
  } catch {
    return reply({ error: 'network' }, 502);
  }

  // 2) Sin lead NO se crea uno. A esta altura del flujo `mc-lead` ya corrió: si no
  //    está, es un bug del flujo, y crear acá un lead sin `Canal origen` lo mandaría
  //    a la puerta «Sin canal registrado» y taparía el problema. Se responde 200 para
  //    que ManyChat no entre en bucle de reintentos, pero marcado.
  if (!lead) return reply({ ok: false, motivo: 'sin_lead', handle });

  // 3) Se sella UNA sola vez. Si el lead vuelve a pasar por el flujo, la fecha
  //    original manda: la cohorte de la semana no se puede reescribir hacia adelante.
  if (lead.fields['Fecha aceptó llamada']) {
    return reply({ ok: true, leadId: lead.id, motivo: 'ya_sellado', desde: lead.fields['Fecha aceptó llamada'] });
  }

  const fields = {
    'Fecha aceptó llamada': now,
    'Fecha última interacción': now,
  };
  // ⚠️ `Estado` NO se toca. Ver la cabecera.

  const pr = await afetch(`${api(LEADS)}/${lead.id}`, {
    method: 'PATCH', headers: wH,
    body: JSON.stringify({ typecast: true, fields }),
  });
  if (!pr.ok) return reply({ error: 'airtable_update', status: pr.status, detail: await pr.text() }, 502);

  return reply({ ok: true, leadId: lead.id, sellado: now });
}

// GET describe el contrato, como el resto de los puentes.
export async function onRequestGet() {
  return reply({
    endpoint: '/api/mc-acepta',
    que_hace: 'Sella Leads.Fecha aceptó llamada cuando la persona acepta que un experto la llame.',
    contrato: { metodo: 'POST', query: 'key=<MC_KEY>', body: { handle: '{{ig_username}}' } },
    no_hace: 'NO toca Leads.Estado. NO crea leads.',
    respuestas: ['ok+sellado', 'ok+ya_sellado', 'ok:false+sin_lead', 'unauthorized', 'not_configured'],
  });
}
