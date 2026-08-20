// Prueba el BRIEFING DE LA MAÑANA con Airtable y ManyChat simulados.
//
// ═══════════════════════════════════════════════════════════════════════════
// EL CASO QUE MOTIVÓ TODO ESTO (2026-08-19)
// ═══════════════════════════════════════════════════════════════════════════
// Luis recibió, trece mañanas seguidas, «2 por llamar: (1) Nicolás Springmuller
// esperando 14d (2) Rodrigo Riquelme esperando 13d» — sobre gente que él ya había
// llamado y marcado «Sin interés».
//
// Causa: el briefing armaba su cola con `{Estado}='Llamada pendiente'`, pero
// `Estado` no es el campo que toca Luis. Luis arrastra la tarjeta, y eso escribe
// `Salida`. `Estado` era un espejo que dos caminos de `salida-llamado` no
// alcanzaban a escribir (`sin_lead` y `ya_enviado`).
//
// La prueba de abajo mira la FÓRMULA que el briefing le manda a Airtable, porque
// ahí es donde vivía la mentira: el filtro corre del lado de Airtable, así que
// simular registros «fantasma» no probaría nada.
import { onRequestGet } from '../functions/api/cron-briefing.js';
import { _resetEquipoCache } from '../lib/avisos.js';

let fail = 0, total = 0;
const check = (ok, msg, extra) => {
  total++;
  console.log((ok ? 'OK   ' : 'FALLO') + ' · ' + msg + (ok ? '' : '  → ' + JSON.stringify(extra)));
  if (!ok) fail++;
};

const ENV = {
  AIRTABLE_TOKEN: 'r', AIRTABLE_WRITE_TOKEN: 'w',
  MANYCHAT_TOKEN: 'mc', FLOW_NS_BRIEFING: 'ns_brief',
  BRIEFING_SIDS: '111', BRIEFING_V2: '1',
};

const hace = (dias) => new Date(Date.now() - dias * 86400000).toISOString();

function mock({ llamados = [], solicitudes = [], consignaciones = [], avisos = [], visitas = [], fallar = null } = {}) {
  _resetEquipoCache();
  const calls = { formulas: {}, patch: [], setField: [], sendFlow: [] };
  const tabla = (u) => (u.match(/\/v0\/[^/]+\/([^?/]+)/) || [])[1];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url), m = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
    const t = tabla(u);

    if (u.includes('/Equipo')) return J({ error: 'x' }, 404);
    if (fallar && t === fallar && m === 'GET') return J({ error: 'INVALID_PERMISSIONS' }, 403);
    if (m === 'GET' && u.includes('filterByFormula=')) {
      calls.formulas[t] = decodeURIComponent(u.split('filterByFormula=')[1].split('&')[0]);
    }
    if (m === 'PATCH') { calls.patch.push({ tabla: t, records: body.records || [body.fields] }); return J({}); }
    if (m === 'GET' && t === 'Leads') return J({ records: visitas });
    if (m === 'GET' && t === 'Llamados') return J({ records: llamados });
    if (m === 'GET' && t === 'Solicitudes') return J({ records: solicitudes });
    if (m === 'GET' && t === 'Consignaciones') return J({ records: consignaciones });
    if (m === 'GET' && t === 'Avisos') return J({ records: avisos });
    if (u.includes('setCustomFieldByName')) { calls.setField.push(body); return J({}); }
    if (u.includes('sendFlow')) { calls.sendFlow.push(body); return J({}); }
    return J({});
  };
  return calls;
}

async function run(estado = {}, env = ENV) {
  const calls = mock(estado);
  const res = await onRequestGet({ request: { url: 'https://x/api/cron-briefing?force=1' }, env });
  return { out: await res.json(), calls };
}

const variable = (calls, campo) => (calls.setField.find(f => f.field_name === campo) || {}).field_value || '';

// ── 1 · LA REGRESIÓN ────────────────────────────────────────────────────────
console.log('\n── 1 · La cola se define por Salida, no por el espejo Estado');
{
  const { calls } = await run();
  const f = calls.formulas['Llamados'] || '';
  check(/\{Salida\}='Llamada pendiente'/.test(f), 'pregunta por {Salida}, el campo que toca Luis', f);
  check(/\{Salida\}='No contestado'/.test(f), 'e incluye «No contestado», que sigue siendo cola de reintentos', f);
  check(!/\{Estado\}='Llamada pendiente'/.test(f),
    '🔴 y NO por {Estado}: ése era el bug que repitió a Rodrigo 13 días', f);
  check(/\{Salida\}=BLANK\(\)/.test(f), 'y cubre el ticket recién creado que aún no tiene columna', f);
}

// ── 2 · Las cuatro colas, con su acción pendiente ───────────────────────────
console.log('\n── 2 · Cinco secciones, no dos');
{
  const { out, calls } = await run({
    llamados: [{ id: 'recL1', createdTime: hace(3), fields: { Nombre: 'Ana', 'Teléfono': '+56911', Canal: 'WhatsApp' } }],
    avisos: [{ id: 'recA1', createdTime: hace(1), fields: { '@handle IG': 'paljaro', Canal: 'DM IG', Mensaje: 'Quiero una de entrada, no soy ciclista' } }],
    solicitudes: [{ id: 'recS1', createdTime: hace(2), fields: { 'Modelo buscado': 'Epic 8', Talla: 'M', Contacto: '+56922' } }],
    consignaciones: [{ id: 'recC1', createdTime: hace(1), fields: { Modelo: 'Tarmac SL7', 'Precio esperado': 3500000, Contacto: '+56933' } }],
  });
  const t = variable(calls, 'cf_llamados_hoy');
  check(t.includes('📞 POR LLAMAR'), 'llamadas pendientes', t);
  // El título es la ACCIÓN, en imperativo — Gabriel lo pidió con esas palabras:
  // «falta responderle a esta persona».
  check(t.includes('🆘 FALTA RESPONDER'), '🔴 conversaciones que el bot derivó a un humano (antes NO las listaba nadie)', t);
  check(t.includes('🔎 POR BUSCAR'), 'encargos de búsqueda', t);
  check(t.includes('🚲 POR EVALUAR'), 'consignaciones nuevas', t);
  check(t.includes('Quiero una de entrada'), 'con el detalle de lo que pasó', t);
  check(t.includes('🆕 nadie lo ha visto'), 'y marcando lo que entró sin que nadie se enterara', t);
  check(out.colas.avisos.total === 1 && out.colas.consignaciones.total === 1, 'la respuesta cuenta las cuatro colas', out.colas);
}

// ── 3 · Sellar lo que se listó, en las CUATRO tablas ────────────────────────
console.log('\n── 3 · Sellado');
{
  const { calls, out } = await run({
    llamados: [{ id: 'recL1', createdTime: hace(3), fields: { Nombre: 'Ana', 'Teléfono': '+56911' } }],
    avisos: [{ id: 'recA1', createdTime: hace(1), fields: { '@handle IG': 'x' } }],
    solicitudes: [{ id: 'recS1', createdTime: hace(2), fields: { 'Modelo buscado': 'Epic 8' } }],
    consignaciones: [{ id: 'recC1', createdTime: hace(1), fields: { Modelo: 'Tarmac' } }],
  });
  const sellado = (t) => calls.patch.some(p => p.tabla === t && p.records.some(r => r.fields?.['Aviso equipo enviado']));
  for (const t of ['Llamados', 'Avisos', 'Solicitudes', 'Consignaciones']) {
    check(sellado(t), `sella ${t} (si no, el barrido de las 09:15 mandaría además el aviso individual)`, calls.patch);
  }
  check(Object.values(out.sellados).reduce((a, b) => a + b, 0) === 4, 'cuatro registros sellados', out.sellados);
}
{
  // Si el briefing no le llegó a NADIE, no se puede sellar nada: sellar sería
  // declarar que el equipo se enteró de algo que nunca recibió.
  const { calls } = await run(
    { llamados: [{ id: 'recL1', createdTime: hace(3), fields: { Nombre: 'Ana' } }] },
    { ...ENV, FLOW_NS_BRIEFING: '' });
  check(!calls.patch.some(p => p.records.some(r => r.fields?.['Aviso equipo enviado'])),
    'briefing que no salió → no sella nada (lo recoge el barrido, uno por uno)', calls.patch);
}
{
  // Lo que ya tenía sello se lista igual (por si el aviso individual salió un día
  // que nadie miró) pero no se vuelve a sellar.
  const { calls } = await run({
    llamados: [{ id: 'recL1', createdTime: hace(3), fields: { Nombre: 'Ana', 'Aviso equipo enviado': hace(2) } }],
  });
  check(variable(calls, 'cf_llamados_hoy').includes('Ana'), 'lo ya avisado SIGUE en el briefing hasta que se resuelva', variable(calls, 'cf_llamados_hoy'));
  check(variable(calls, 'cf_llamados_hoy').includes('esperando 3d'), 'con cuánto lleva esperando', variable(calls, 'cf_llamados_hoy'));
  check(!calls.patch.some(p => p.records.some(r => r.fields?.['Aviso equipo enviado'])), 'y no se re-sella', calls.patch);
}

// ── 4 · Ventana de los avisos ───────────────────────────────────────────────
console.log('\n── 4 · Higiene');
{
  const { out } = await run({ avisos: [{ id: 'recA1', createdTime: hace(30), fields: { '@handle IG': 'viejo' } }] });
  check(out.colas.avisos.total === 0, 'un aviso sin resolver de hace 30 días sale del briefing (si no, el equipo aprende a ignorarlo)', out.colas);
}
{
  const { out } = await run({}, { ...ENV, AVISOS_VENTANA_DIAS: '60' });
  check(out.ok === true, 'la ventana es configurable por env', out);
}

// ── 4-bis · Un fallo de lectura NO puede parecerse a «nada pendiente» ───────
console.log('\n── 4-bis · Fallo de lectura');
{
  // 🔴 Antes `leerTodo` hacía `break` y devolvía []: con el token vencido o una
  // tabla renombrada, el briefing habría dicho «nada pendiente 🌱» —en verde y
  // con ok:true— todas las mañanas, mientras la cola se llenaba.
  const { out, calls } = await run({ fallar: 'Solicitudes' });
  const t = variable(calls, 'cf_llamados_hoy');
  check(t.includes('NO SE PUDO LEER'), 'lo dice en el mensaje que le llega al equipo', t);
  check(t.includes('Solicitudes'), 'y nombra la tabla', t);
  check(!t.includes('nada pendiente'), 'y NO afirma que no hay nada pendiente', t);
  check(out.erroresLectura?.length === 1 && out.erroresLectura[0].status === 403, 'y lo reporta en la respuesta', out.erroresLectura);
}

// ── 4-ter · La espera se cuenta desde que volvió a la cola ──────────────────
{
  // Un ticket creado hace 14 días pero reencolado anteayer (apretó «Sí, llámenme»)
  // lleva esperando 2 días, no 14. Decir 14 entrena al equipo a ignorar el número.
  const { calls } = await run({
    llamados: [{ id: 'recL1', createdTime: hace(14), fields: { Nombre: 'Ana', 'Aviso equipo enviado': hace(2), 'Pidió rellamada': hace(2) } }],
  });
  const t = variable(calls, 'cf_llamados_hoy');
  check(t.includes('esperando 2d') && !t.includes('esperando 14d'), 'cuenta desde el reencolado, no desde la creación', t);
}

// ── 5 · Nada pendiente ──────────────────────────────────────────────────────
{
  const { calls } = await run();
  check(variable(calls, 'cf_llamados_hoy').includes('nada pendiente'), 'con la cola vacía lo dice, no manda un mensaje mocho', variable(calls, 'cf_llamados_hoy'));
  check(variable(calls, 'cf_agenda_hoy').includes('sin visitas hoy'), 'y lo mismo con la agenda', variable(calls, 'cf_agenda_hoy'));
}

console.log('');
if (fail) { console.log(`FALLARON ${fail} de ${total}`); process.exit(1); }
console.log(`TODAS OK (${total} aserciones)`);
