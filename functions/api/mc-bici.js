// Cloudflare Pages Function · GET/POST /api/mc-bici
//
// Resuelve una bicicleta a partir de la `Referencia` que viaja en el mensaje del
// sitio, y devuelve lo que el flujo de WhatsApp necesita para trabajar con ella.
//
// POR QUÉ EXISTE. Los botones del sitio abren WhatsApp con el texto prellenado
// «…de la Specialized Epic 8 Pro talla L (ref 4082552).». Ese `ref` es
// `Inventario.Referencia` — el identificador público y estable de cada unidad, el
// mismo que usa Ailoo. Pero `mc-evento` y `mc-llamado` solo saben resolver la bici
// por **recId** o por **reel**, así que sin este puente el Interés y el ticket
// nacerían SIN bici: se perdería la atribución por unidad, que es justamente lo que
// el negocio quiere medir en la puerta web.
//
// No es un round-trip extra: el flujo necesita igual el modelo, la talla, el precio
// y la URL de la ficha para poder MANDAR la ficha. Una sola llamada sirve para las
// dos cosas — armar el mensaje y enlazar el registro.
//
// Solo LEE. No escribe nada. Protegido por MC_KEY.

const JSONH = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSONH });

const BASE_DEFAULT = 'appQUgk8aeD752923';
const SITE_DEFAULT = 'https://biketrust-sitio.pages.dev';

async function afetch(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, opts);
    if (r.status !== 429 || i >= tries - 1) return r;
    await new Promise((res) => setTimeout(res, 1200 * (i + 1)));
  }
}

const keyOk = (env, url) => (env.MC_KEY ? url.searchParams.get('key') === env.MC_KEY : true);

// El slug con que el sitio publica cada ficha. Reconstruye `slug(modelo-talla)` de
// `build.mjs` — mismo contrato que ya usa `mc-match`.
//
// ⚠️ Si DOS unidades comparten modelo+talla, `build.mjs` desambigua con `-2`, `-3`…
// y esa parte no se puede reconstruir desde acá. No rompe el caso que importa: las
// `Disponible` se ordenan primero y conservan el slug SIN sufijo, y solo se manda la
// ficha de una bici disponible. Una segunda unidad idéntica y vendida caería en el
// slug de la primera — por eso el flujo debe mirar `disponible` antes de enviar nada.
const norm = (s) => String(s).toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');
const slugDe = (b) => norm(`${b['Modelo'] || ''}-${b['Talla'] || ''}`) || 'bici';

const clp = (n) => (n == null || n === '' ? null
  : '$' + Number(n).toLocaleString('es-CL', { maximumFractionDigits: 0 }));

async function resolver(env, ref, slugPedido) {
  const BASE = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  const INV  = env.AIRTABLE_INVENTARIO_TABLE || 'Inventario';
  if (!READ) return { error: 'not_configured', status: 503 };

  const api = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(INV)}`;
  const rH  = { Authorization: `Bearer ${READ}` };

  let rec = null;
  if (ref) {
    // `Referencia` puede venir como número o texto según cómo se cargó; se compara
    // como texto para que «4082552» calce en ambos casos.
    const f = `{Referencia}&''='${String(ref).replace(/'/g, "\\'")}'`;
    const r = await afetch(`${api}?maxRecords=1&filterByFormula=${encodeURIComponent(f)}`, { headers: rH });
    if (!r.ok) return { error: 'airtable_read', status: 502, detail: await r.text() };
    rec = ((await r.json()).records || [])[0] || null;
  }

  // Fallback por slug: si el mensaje viniera sin `ref` (unidades cargadas antes de
  // que Ailoo estampara la referencia), todavía se puede resolver por el enlace.
  if (!rec && slugPedido) {
    const r = await afetch(`${api}?pageSize=100`, { headers: rH });
    if (r.ok) {
      const todas = (await r.json()).records || [];
      rec = todas.find((x) => slugDe(x.fields) === String(slugPedido).toLowerCase()) || null;
    }
  }

  if (!rec) return { ok: false, motivo: 'sin_bici' };

  const b = rec.fields;
  const site = (env.SITE_URL || SITE_DEFAULT).replace(/\/$/, '');
  const slug = slugDe(b);
  return {
    ok: true,
    // Lo que necesitan `mc-evento` y `mc-llamado` para enlazar el registro:
    bici: rec.id,
    referencia: b['Referencia'] ?? null,
    // Lo que necesita el bot para ARMAR el mensaje:
    modelo: b['Modelo'] || '',
    talla: b['Talla'] || '',
    anio: b['Año'] ?? null,
    precio: b['Precio'] ?? null,
    precio_texto: clp(b['Precio']),
    puntaje: b['Puntaje certificación'] ?? null,
    rango_altura: b['Rango altura'] || '',
    estado: b['Estado'] || '',
    // ⚠️ Que la bici exista NO significa que se pueda ofrecer: puede estar Vendida
    // o Reservada. El flujo tiene que mirar esto ANTES de mandar la ficha.
    disponible: b['Estado'] === 'Disponible',
    ficha_url: `${site}/ficha/${slug}`,
    pagina_url: `${site}/bici/${slug}`,
  };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return reply({ error: 'unauthorized' }, 401);
  const ref = url.searchParams.get('ref');
  const slug = url.searchParams.get('slug');
  if (!ref && !slug) {
    return reply({
      endpoint: '/api/mc-bici',
      que_hace: 'Resuelve una bici por Referencia (la que viaja en el mensaje del sitio) y devuelve el recId para enlazar + los datos para armar el mensaje.',
      contrato: { metodo: 'GET o POST', query: 'key=<MC_KEY>&ref=<Referencia>', alterno: 'slug=<slug de la ficha>' },
      devuelve: ['bici (recId)', 'modelo', 'talla', 'precio_texto', 'puntaje', 'disponible', 'ficha_url'],
      no_hace: 'Solo lee. No escribe nada.',
    });
  }
  const r = await resolver(env, ref, slug);
  return reply(r, r.status && r.status !== 200 ? r.status : 200);
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return reply({ error: 'unauthorized' }, 401);
  let data;
  try { data = await request.json(); } catch { return reply({ error: 'bad_json' }, 400); }
  const ref = data?.ref != null ? String(data.ref).trim() : '';
  const slug = data?.slug ? String(data.slug).trim() : '';
  if (!ref && !slug) return reply({ error: 'missing_fields (ref o slug)' }, 422);
  const r = await resolver(env, ref, slug);
  return reply(r, r.status && r.status !== 200 ? r.status : 200);
}
