// Test de los dos endpoints de la PUERTA WEB: `mc-acepta` y `mc-bici`.
//
// Los va a llamar ManyChat en producción, sin nadie mirando. Sus fallas son del tipo
// que no avisa: un lead que no se encuentra, una bici mal resuelta, un sello que se
// pisa. Airtable se simula entero para poder ejercitarlos sin tocar la base.
//
// Corre con: node test/puerta-web.mjs

import { onRequestPost as aceptaPost, onRequestGet as aceptaGet } from '../functions/api/mc-acepta.js';
import { onRequestGet as biciGet, onRequestPost as biciPost } from '../functions/api/mc-bici.js';

let fallos = 0;
const ok = (cond, nombre, extra) => {
  if (cond) console.log(`  ✓ ${nombre}`);
  else { console.log(`  ✗ ${nombre}${extra ? ' → ' + extra : ''}`); fallos++; }
};
const eq = (a, b, nombre) => ok(
  JSON.stringify(a) === JSON.stringify(b), nombre,
  `esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`,
);

/* ---------------- Airtable simulado ---------------- */
function montar(leads = [], inventario = []) {
  const escrituras = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (url, opciones = {}) => {
    const u = String(url);
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    const tabla = decodeURIComponent((u.match(/appQUgk8aeD752923\/([^?/]+)/) || [])[1] || '');
    const filas = tabla === 'Leads' ? leads : inventario;

    // GET de un registro único: /Tabla/recXXXX
    const porId = u.match(/appQUgk8aeD752923\/[^?/]+\/(rec[A-Za-z0-9]+)/);
    if (porId && (!opciones.method || opciones.method === 'GET')) {
      const r = filas.find((x) => x.id === porId[1]);
      return r ? json(r) : new Response('{}', { status: 404 });
    }

    if (!opciones.method || opciones.method === 'GET') {
      let res = filas;
      const m = u.match(/filterByFormula=([^&]+)/);
      if (m) {
        const f = decodeURIComponent(m[1]);
        let g = null;
        if ((g = f.match(/^\{MC subscriber id\}='(.*)'$/))) {
          res = filas.filter((x) => String(x.fields['MC subscriber id'] || '') === g[1]);
        } else if ((g = f.match(/^LOWER\(\{@handle IG\}\)='(.*)'$/))) {
          res = filas.filter((x) => String(x.fields['@handle IG'] || '').toLowerCase() === g[1]);
        } else if ((g = f.match(/^\{Referencia\}&''='(.*)'$/))) {
          res = filas.filter((x) => String(x.fields['Referencia'] ?? '') === g[1]);
        } else res = [];
      }
      return json({ records: res });
    }

    // PATCH de un registro
    if (opciones.method === 'PATCH') {
      const id = (u.match(/(rec[A-Za-z0-9]+)$/) || [])[1];
      const body = JSON.parse(opciones.body);
      escrituras.push({ id, fields: body.fields });
      const r = filas.find((x) => x.id === id);
      if (r) Object.assign(r.fields, body.fields);
      return json(r || {});
    }
    return json({});
  };

  return { escrituras, restaurar: () => { globalThis.fetch = original; } };
}

const ENV = { AIRTABLE_TOKEN: 'r', AIRTABLE_WRITE_TOKEN: 'w' };
const lead = (id, f) => ({ id, fields: { Estado: 'nuevo', ...f } });
const bici = (id, f) => ({ id, fields: f });

const acepta = (body, { env = ENV, qs = '' } = {}) => aceptaPost({
  request: new Request(`https://x/api/mc-acepta${qs}`, { method: 'POST', body: JSON.stringify(body) }),
  env,
});

/* ================= mc-acepta ================= */
console.log('\n— mc-acepta · resolución del lead —');
{
  const leads = [
    lead('recA', { '@handle IG': 'gabriel', 'MC subscriber id': '555' }),
    lead('recB', { '@handle IG': 'otro', 'MC subscriber id': '999' }),
  ];
  const m = montar(leads);

  let j = await (await acepta({ subscriber_id: '555' })).json();
  eq(j.leadId, 'recA', 'resuelve por subscriber_id — LA vía de WhatsApp');
  ok(!!j.sellado, 'y sella la fecha');

  j = await (await acepta({ handle: '@Otro' })).json();
  eq(j.leadId, 'recB', 'resuelve por @handle, con arroba y mayúsculas');

  j = await (await acepta({ lead: 'recA' })).json();
  eq(j.motivo, 'ya_sellado', 'resuelve por recId y respeta el sello previo');

  j = await (await acepta({ subscriber_id: '404' })).json();
  eq(j.motivo, 'sin_lead', 'subscriber_id desconocido → sin_lead');
  eq(j.ok, false, 'y lo marca como no-ok');
  ok(!leads.some((l) => l.id === 'recNUEVO'), 'NO crea el lead: crearlo sin Canal origen taparía el bug de flujo');

  const r = await acepta({});
  eq(r.status, 422, 'sin ningún identificador → 422');

  m.restaurar();
}

console.log('\n— mc-acepta · el sello no se pisa —');
{
  const leads = [lead('recA', { 'MC subscriber id': '1', 'Fecha aceptó llamada': '2026-08-01T10:00:00.000Z' })];
  const m = montar(leads);
  const j = await (await acepta({ subscriber_id: '1' })).json();
  eq(j.motivo, 'ya_sellado', 'segunda vez → ya_sellado');
  eq(j.desde, '2026-08-01T10:00:00.000Z', 'conserva la fecha ORIGINAL: la cohorte no se reescribe');
  eq(m.escrituras.length, 0, 'y no escribe nada');
  m.restaurar();
}

console.log('\n— mc-acepta · NO toca la máquina de estados —');
{
  const leads = [lead('recA', { 'MC subscriber id': '1', Estado: 'ficha_entregada' })];
  const m = montar(leads);
  await acepta({ subscriber_id: '1' });
  const esc = m.escrituras[0].fields;
  ok(!('Estado' in esc), 'no manda Estado — ese es el punto del diseño');
  ok('Fecha aceptó llamada' in esc, 'manda la fecha del hito');
  ok('Fecha última interacción' in esc, 'y toca la última interacción');
  eq(leads[0].fields.Estado, 'ficha_entregada', 'el Estado del lead queda igual');
  m.restaurar();
}

console.log('\n— mc-acepta · guardas —');
{
  const m = montar([lead('recA', { 'MC subscriber id': '1' })]);
  let r = await acepta({ subscriber_id: '1' }, { env: { ...ENV, MC_KEY: 'secreta' } });
  eq(r.status, 401, 'con MC_KEY configurada y sin clave → 401');
  r = await acepta({ subscriber_id: '1' }, { env: { ...ENV, MC_KEY: 'secreta' }, qs: '?key=secreta' });
  eq(r.status, 200, 'con la clave correcta pasa');
  r = await acepta({ subscriber_id: '1' }, { env: { AIRTABLE_TOKEN: 'r' } });
  eq(r.status, 503, 'sin token de escritura → 503, no un fallo silencioso');
  const g = await (await aceptaGet()).json();
  ok(String(g.no_hace).includes('NO toca'), 'el GET documenta que no toca el Estado');
  m.restaurar();
}

/* ================= mc-bici ================= */
console.log('\n— mc-bici · resolución por Referencia —');
{
  const inv = [
    bici('recE', { Referencia: '4082552', Modelo: 'Epic 8 Pro', Talla: 'L', Año: 2024,
      Precio: 6500000, 'Puntaje certificación': 6.8, 'Rango altura': '178 a 188 cm', Estado: 'Disponible' }),
    bici('recV', { Referencia: '111', Modelo: 'Levo SL2', Talla: 'M', Estado: 'Vendida' }),
  ];
  const m = montar([], inv);
  const get = (qs, env = ENV) => biciGet({ request: new Request(`https://x/api/mc-bici${qs}`), env });

  let j = await (await get('?ref=4082552')).json();
  eq(j.bici, 'recE', 'devuelve el recId — sin esto el Interés nace sin bici');
  eq(j.modelo, 'Epic 8 Pro', 'y el modelo para armar el mensaje');
  eq(j.precio_texto, '$6.500.000', 'el precio ya formateado en pesos');
  eq(j.disponible, true, 'marca que se puede ofrecer');
  eq(j.ficha_url, 'https://biketrust-sitio.pages.dev/ficha/epic-8-pro-l', 'la URL de la ficha imprimible');
  eq(j.pagina_url, 'https://biketrust-sitio.pages.dev/bici/epic-8-pro-l', 'y la de la página pública');

  // 🔴 La guarda que evita mandar la ficha de una bici que ya no está.
  j = await (await get('?ref=111')).json();
  eq(j.disponible, false, 'una Vendida se resuelve pero marca disponible=false');
  eq(j.estado, 'Vendida', 'y dice en qué estado está');

  j = await (await get('?ref=000')).json();
  eq(j.motivo, 'sin_bici', 'una referencia inexistente NO se adivina');

  j = await (await get('?slug=epic-8-pro-l')).json();
  eq(j.bici, 'recE', 'fallback por slug para unidades sin Referencia');

  let r = await get('');
  eq((await r.json()).endpoint, '/api/mc-bici', 'sin parámetros describe el contrato');

  r = await get('?ref=4082552', { ...ENV, MC_KEY: 'secreta' });
  eq(r.status, 401, 'respeta MC_KEY');

  m.restaurar();
}

console.log('\n— mc-bici · el slug tiene que calzar con el del sitio —');
{
  // Si el slug no reconstruye EXACTAMENTE el de `build.mjs`, el bot manda un 404.
  const casos = [
    [{ Referencia: '1', Modelo: 'Epic 8 Pro', Talla: 'L' }, 'epic-8-pro-l'],
    [{ Referencia: '2', Modelo: 'Levo 4G S-Works', Talla: 'S4' }, 'levo-4g-s-works-s4'],
    [{ Referencia: '3', Modelo: 'Crux Expert', Talla: '54' }, 'crux-expert-54'],
    [{ Referencia: '4', Modelo: 'Turbo Vado SL', Talla: 'M' }, 'turbo-vado-sl-m'],
    [{ Referencia: '5', Modelo: 'Créo SL', Talla: 'M' }, 'creo-sl-m'],
  ];
  for (const [f, esperado] of casos) {
    const m = montar([], [bici('r', f)]);
    const j = await (await biciGet({ request: new Request(`https://x/api/mc-bici?ref=${f.Referencia}`), env: ENV })).json();
    eq(j.ficha_url.split('/ficha/')[1], esperado, `«${f.Modelo} ${f.Talla}» → ${esperado}`);
    m.restaurar();
  }
}

console.log('\n— mc-bici · POST y validación —');
{
  const m = montar([], [bici('recE', { Referencia: '7', Modelo: 'Epic', Talla: 'L', Estado: 'Disponible' })]);
  const post = (body) => biciPost({
    request: new Request('https://x/api/mc-bici', { method: 'POST', body: JSON.stringify(body) }), env: ENV,
  });
  let j = await (await post({ ref: 7 })).json();
  eq(j.bici, 'recE', 'acepta la referencia como número, no solo texto');
  const r = await post({});
  eq(r.status, 422, 'sin ref ni slug → 422');
  m.restaurar();
}

/* ---------------- resultado ---------------- */
console.log('');
if (fallos) { console.error(`✗ ${fallos} comprobaciones fallaron`); process.exit(1); }
console.log('✓ la puerta web responde lo que dice');
