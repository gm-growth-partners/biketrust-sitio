// test/mc-lead-canales.mjs — `mc-lead` con los DOS identificadores.
//
// 🔴 POR QUÉ EXISTE. La cascada de DM se duplicó y convirtió a WhatsApp (2026-08-15).
// `mc-lead` es el PRIMER paso de esa cascada y hasta ese día solo aceptaba `handle`
// (`{{ig_username}}`), que **en WhatsApp no existe**: habría devuelto 422 en el primer
// nodo, no habría nacido ningún Lead, y todo lo de abajo —ficha, teléfono, ticket—
// habría caído en `sin_lead` sin que nadie se enterara.
//
// Y no basta con aceptarlo: hay que GUARDARLO. Un lead de WhatsApp sin
// `MC subscriber id` es invisible para `mc-evento`, `mc-acepta` y `mc-llamado`.
//
// Corre con: node test/mc-lead-canales.mjs

import { onRequestPost } from '../functions/api/mc-lead.js';

let fallos = 0;
const ok = (cond, nombre, extra) => {
  if (cond) console.log(`  ✓ ${nombre}`);
  else { console.log(`  ✗ ${nombre}${extra ? ' → ' + extra : ''}`); fallos++; }
};
const eq = (a, b, nombre) => ok(
  JSON.stringify(a) === JSON.stringify(b), nombre,
  `esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`,
);

function montar(leads = []) {
  const escrituras = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, o = {}) => {
    const u = String(url);
    const json = (x) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
    const metodo = o.method || 'GET';

    if (metodo === 'GET') {
      const m = u.match(/filterByFormula=([^&]+)/);
      if (!m) return json({ records: leads });
      // Airtable interpreta `\'` dentro de la fórmula como una comilla literal. El
      // simulador tiene que hacer lo mismo o la prueba del escape mide al revés.
      const f = decodeURIComponent(m[1]).replace(/\\'/g, "'");
      let g = null, res = [];
      if ((g = f.match(/^\{MC subscriber id\}='(.*)'$/))) {
        res = leads.filter((x) => String(x.fields['MC subscriber id'] || '') === g[1]);
      } else if ((g = f.match(/^LOWER\(\{@handle IG\}\)='(.*)'$/))) {
        res = leads.filter((x) => String(x.fields['@handle IG'] || '').toLowerCase() === g[1]);
      }
      return json({ records: res });
    }
    if (metodo === 'POST') {
      const b = JSON.parse(o.body);
      escrituras.push({ tipo: 'crear', fields: b.fields });
      const rec = { id: 'recNUEVO', createdTime: '2026-08-15T00:00:00.000Z', fields: b.fields };
      leads.push(rec);
      return json(rec);
    }
    if (metodo === 'PATCH') {
      const b = JSON.parse(o.body);
      escrituras.push({ tipo: 'tocar', fields: b.fields });
      return json({ id: 'x', fields: b.fields });
    }
    return json({});
  };
  return { escrituras, leads, restaurar: () => { globalThis.fetch = original; } };
}

const ENV = { AIRTABLE_TOKEN: 'r', AIRTABLE_WRITE_TOKEN: 'w' };
const llamar = (body, env = ENV) => onRequestPost({
  request: new Request('https://x/api/mc-lead', { method: 'POST', body: JSON.stringify(body) }), env,
});
const lead = (id, f) => ({ id, createdTime: '2026-01-01T00:00:00.000Z', fields: f });

/* ================= el caso que rompía WhatsApp ================= */
console.log('\n— WhatsApp: solo subscriber_id —');
{
  const m = montar([]);
  const r = await llamar({ subscriber_id: '12345', canal: 'Web', nombre: 'Gabriel M' });
  const j = await r.json();
  eq(r.status, 200, 'ya NO devuelve 422 sin handle');
  ok(j.created, 'crea el lead');
  const c = (m.escrituras.find((e) => e.tipo === 'crear') || {}).fields || {};
  eq(c['MC subscriber id'], '12345', '🔴 GUARDA el subscriber_id — sin esto el lead es invisible después');
  eq(c['Canal origen'], 'Web', 'con el canal que le pasaron');
  ok(!('@handle IG' in c), 'y NO inventa un @handle vacío');
  m.restaurar();
}

console.log('\n— lo encuentra por subscriber_id la segunda vez —');
{
  const m = montar([lead('recA', { 'MC subscriber id': '999', 'Canal origen': 'Web' })]);
  const j = await (await llamar({ subscriber_id: '999', canal: 'Web' })).json();
  eq(j.leadId, 'recA', 'no duplica: reconoce al mismo');
  eq(j.created, false, 'y lo marca como existente');
  m.restaurar();
}

/* ================= Instagram sigue igual ================= */
console.log('\n— Instagram: el camino de siempre no se tocó —');
{
  const m = montar([]);
  const j = await (await llamar({ handle: '@gabriel', canal: 'DM IG' })).json();
  ok(j.created, 'crea por handle');
  const c = (m.escrituras.find((e) => e.tipo === 'crear') || {}).fields || {};
  eq(c['@handle IG'], 'gabriel', 'guarda el handle sin arroba');
  ok(!('MC subscriber id' in c), 'y no inventa un subscriber_id');
  m.restaurar();
}
{
  const m = montar([lead('recB', { '@handle IG': 'Gabriel' })]);
  const j = await (await llamar({ handle: 'gabriel', canal: 'DM IG' })).json();
  eq(j.leadId, 'recB', 'sigue encontrando por handle sin importar mayúsculas');
  m.restaurar();
}

/* ================= la unificación entre canales ================= */
console.log('\n— la misma persona que comenta en IG y después escribe por WhatsApp —');
{
  // Es el caso real: comentó un reel (nació con @handle) y semanas después aprieta el
  // botón del sitio. Si no se guarda su subscriber_id, queda como DOS personas.
  const m = montar([lead('recC', { '@handle IG': 'carlos' })]);
  await llamar({ handle: 'carlos', subscriber_id: '777', canal: 'Web' });
  const t = (m.escrituras.find((e) => e.tipo === 'tocar') || {}).fields || {};
  eq(t['MC subscriber id'], '777', 'le pega el subscriber_id al lead que ya existía');
  ok(!('@handle IG' in t), 'y no reescribe el handle que ya tenía');
  m.restaurar();
}
{
  const m = montar([lead('recD', { 'MC subscriber id': '888' })]);
  await llamar({ handle: 'nuevo_handle', subscriber_id: '888', canal: 'DM IG' });
  const t = (m.escrituras.find((e) => e.tipo === 'tocar') || {}).fields || {};
  eq(t['@handle IG'], 'nuevo_handle', 'y al revés: le pega el handle al lead de WhatsApp');
  m.restaurar();
}
{
  const m = montar([lead('recE', { 'MC subscriber id': '1', '@handle IG': 'ya_tiene' })]);
  await llamar({ handle: 'otro', subscriber_id: '1', canal: 'Web' });
  const t = (m.escrituras.find((e) => e.tipo === 'tocar') || {}).fields || {};
  ok(!('@handle IG' in t), 'NO pisa un handle que ya estaba — el original manda');
  m.restaurar();
}

/* ================= guardas ================= */
console.log('\n— guardas —');
{
  const m = montar([]);
  let r = await llamar({ canal: 'Web' });
  eq(r.status, 422, 'sin ningún identificador → 422');
  r = await llamar({ subscriber_id: '1' });
  eq(r.status, 422, 'sin canal → 422 (o el lead cae en la puerta equivocada)');
  eq(m.escrituras.length, 0, 'y no escribe nada');

  r = await llamar({ subscriber_id: '1', canal: 'Web' }, { ...ENV, MC_KEY: 'k' });
  eq(r.status, 401, 'respeta MC_KEY');
  m.restaurar();
}

console.log('\n— la comilla en el identificador no rompe la fórmula —');
{
  // Airtable interpola el valor en una fórmula: sin escapar, una comilla la parte.
  const m = montar([lead('recF', { 'MC subscriber id': "a'b" })]);
  const j = await (await llamar({ subscriber_id: "a'b", canal: 'Web' })).json();
  eq(j.leadId, 'recF', 'encuentra al lead cuyo id lleva comilla');
  m.restaurar();
}

console.log('');
if (fallos) { console.error(`✗ ${fallos} comprobaciones fallaron`); process.exit(1); }
console.log('✓ mc-lead funciona en los dos canales');
