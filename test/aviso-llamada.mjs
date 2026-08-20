// Prueba `aviso-llamada` — LA ENTRADA COMÚN de «alguien dejó su teléfono» —
// con Airtable y ManyChat simulados. Ejecuta el CÓDIGO REAL del endpoint.
//
// La aserción que más importa es la primera: la rama de deduplicación reventaba
// con un ReferenceError en producción y devolvía 500 justo en el caso más valioso
// del embudo (el lead que YA dejó su número y vuelve a preguntar por otra bici).
import { onRequestPost } from '../functions/api/aviso-llamada.js';
import { _resetEquipoCache } from '../lib/avisos.js';

let fail = 0, total = 0;
const check = (ok, msg, extra) => {
  total++;
  console.log((ok ? 'OK   ' : 'FALLO') + ' · ' + msg + (ok ? '' : '  → ' + JSON.stringify(extra)));
  if (!ok) fail++;
};

// ── Reloj congelado ─────────────────────────────────────────────────────────
// Chile es UTC-4 en julio: 17:00Z = 13:00 (dentro de la franja 9-20) y
// 06:00Z = 02:00 de la madrugada (fuera).
const RealDate = Date;
const congelar = (iso) => {
  const t = new RealDate(iso).getTime();
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (!a.length) super(t); else super(...a); }
    static now() { return t; }
  };
};
const descongelar = () => { globalThis.Date = RealDate; };
const DENTRO = '2026-07-15T17:00:00Z';
const FUERA = '2026-07-16T06:00:00Z';

const ENV = {
  AIRTABLE_TOKEN: 'r', AIRTABLE_WRITE_TOKEN: 'w',
  MANYCHAT_TOKEN: 'mc', FLOW_NS_LLAMADO: 'ns_llamado',
  AVISO_LLAMADO_SIDS: '111,222', AVISO_FRANJA: '9-20',
};

const LEAD = {
  id: 'recLEAD',
  fields: {
    Nombre: 'Nicolás Springmuller', '@handle IG': 'nspringm2020',
    'MC subscriber id': '1979973583', Estado: 'match_entregado',
    Intereses: ['recI1'], Llamados: ['recT'], Avisos: ['recA1'],
  },
};

function mock({ leads = [], abiertos = [], equipo = null } = {}) {
  _resetEquipoCache();
  const calls = { leadPost: null, leadPatch: [], llamPost: null, llamPatch: [], setField: [], sendFlow: [] };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url), m = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s });

    if (u.includes('/Equipo')) return equipo ? J({ records: equipo.map((f, i) => ({ id: `recE${i}`, fields: f })) }) : J({ error: 'x' }, 404);
    if (/\/Leads\?/.test(u)) return J({ records: leads });
    if (/\/Leads\/rec/.test(u) && m === 'PATCH') { calls.leadPatch.push(body.fields); return J({}); }
    if (/\/Leads\/rec/.test(u)) return J({ fields: leads[0]?.fields || {} });
    if (/\/Leads$/.test(u) && m === 'POST') { calls.leadPost = body.fields; return J({ id: 'recNUEVO' }); }
    // Mock estricto: el dedup DEBE buscar por RECORD_ID() sobre el enlace inverso
    // `Leads.Llamados`. Con `FIND(leadId, ARRAYJOIN({Lead}))` —que es lo que hacía
    // `mc-rellamar` y lo que esta entrada heredó por un rato— Airtable devuelve
    // cero filas siempre, porque un campo de enlace se evalúa a su valor visible.
    if (/\/Llamados\?/.test(u)) {
      const f = decodeURIComponent((u.split('filterByFormula=')[1] || '').split('&')[0]);
      if (!/RECORD_ID\(\)/.test(f)) { calls.consultaMala = f; return J({ records: [] }); }
      return J({ records: abiertos });
    }
    if (/\/Llamados\/rec/.test(u) && m === 'PATCH') { calls.llamPatch.push(body.fields); return J({}); }
    if (/\/Llamados$/.test(u) && m === 'POST') { calls.llamPost = body.fields; return J({ id: 'recTICKET' }); }
    if (/\/Inventario\/rec/.test(u)) return J({ fields: { Modelo: 'Levo SL S-Works' } });
    if (/\/Inventario\?/.test(u)) return J({ records: [{ id: 'recBICI' }] });
    if (/\/Intereses\/rec/.test(u)) return J({ fields: { Bici: ['recBICI'], Resultado: 'Ficha entregada', Fecha: '2026-07-10' } });
    if (/\/Reels\?/.test(u)) return J({ records: [{ fields: { Bici: ['recBICI'] } }] });
    if (u.includes('setCustomFieldByName')) { calls.setField.push(body); return J({}); }
    if (u.includes('sendFlow')) { calls.sendFlow.push(body); return J({}); }
    return J({});
  };
  return calls;
}

async function run(payload, { ahora = DENTRO, env = ENV, ...estado } = {}) {
  const calls = mock(estado);
  congelar(ahora);
  try {
    const res = await onRequestPost({
      request: { url: 'https://x/api/aviso-llamada', json: async () => payload },
      env,
    });
    return { status: res.status, out: await res.json(), calls, error: null };
  } catch (e) {
    return { status: 500, out: null, calls, error: e };
  } finally {
    descongelar();
  }
}

const textoAviso = (calls) => (calls.setField.find(f => f.field_name === 'cf_llamado_datos') || {}).field_value || '';
const sello = (calls) => calls.llamPatch.find(p => 'Aviso equipo enviado' in p);

// ── 1 · LA REGRESIÓN: la rama de dedup reventaba con 500 ────────────────────
console.log('\n── 1 · El lead que VUELVE (la rama que reventaba)');
{
  const hace3h = '2026-07-15T14:00:00Z';
  const { status, out, calls, error } = await run(
    { handle: 'nspringm2020', telefono: '+56942327952', bici: 'recBICI', canal: 'DM IG' },
    { leads: [LEAD], abiertos: [{ id: 'recT', createdTime: '2026-07-10T12:00:00Z', fields: { Lead: ['recLEAD'], Salida: 'Llamada pendiente', 'Aviso equipo enviado': hace3h, 'Teléfono': '+56942327952' } }] });

  check(!error, '🔴 NO revienta con ReferenceError (antes: TDZ sobre `nombre` → 500)', error && String(error.message));
  check(status === 200 && out?.dedup === true, 'reconoce el ticket abierto y no crea uno nuevo', out);
  check(calls.llamPost === null, 'NUNCA crea un segundo ticket para el mismo lead', calls.llamPost);
  check(out?.aviso === 'enviado', 'y avisa al equipo de que volvió', out);
  check(textoAviso(calls).includes('VOLVIÓ'), 'el aviso dice que VOLVIÓ, no parece un lead nuevo', textoAviso(calls));
}
{
  // Rearme: si al equipo ya se le avisó hace 10 minutos, volver a comentar en otro
  // reel NO puede producir un segundo WhatsApp.
  const hace10min = '2026-07-15T16:50:00Z';
  const { out, calls } = await run(
    { handle: 'nspringm2020', telefono: '+56942327952' },
    { leads: [LEAD], abiertos: [{ id: 'recT', createdTime: '2026-07-10T12:00:00Z', fields: { Lead: ['recLEAD'], Salida: 'Llamada pendiente', 'Aviso equipo enviado': hace10min } }] });
  check(out?.aviso === 'omitido_rearme' && calls.sendFlow.length === 0, 'una ráfaga en la misma hora produce UN aviso, no tres', out);
}

// ── 2 · Identidad multicanal ────────────────────────────────────────────────
console.log('\n── 2 · Identidad multicanal (antes exigía @handle de Instagram)');
{
  const { status, out, calls } = await run(
    { subscriber_id: '1979973583', telefono: '+56911111111', canal: 'WhatsApp' },
    { leads: [LEAD] });
  check(status === 200, 'WhatsApp: sólo con subscriber_id ya NO devuelve 422', out);
  check(calls.llamPost?.Canal === 'WhatsApp', 'el canal queda escrito en el ticket', calls.llamPost);
  check(textoAviso(calls).includes('por WhatsApp'), 'y el equipo sabe por dónde responder', textoAviso(calls));
}
{
  const { status, calls } = await run(
    { telefono: '+56922222222', canal: 'Web' }, { leads: [] });
  check(status === 200, 'Web: sólo con teléfono tampoco devuelve 422', calls);
  check(calls.leadPost?.['Canal origen'] === 'Web', 'el lead nace con Canal origen = Web (cuenta en la Puerta 3)', calls.leadPost);
  check(calls.leadPost?.WhatsApp === '+56922222222', 'y con su teléfono', calls.leadPost);
}
{
  const { status, out } = await run({ canal: 'Web' }, { leads: [] });
  check(status === 422 && /missing_fields/.test(out?.error || ''), 'sin ningún identificador sí es 422', out);
}

// ── 3 · El contexto de la conversación ──────────────────────────────────────
console.log('\n── 3 · Contexto para quien llama («qué bici vio, qué preguntó»)');
{
  const { calls, out } = await run(
    { handle: 'nspringm2020', telefono: '+56942327952', bici: 'recBICI', mensaje: '¿el precio es conversable?' },
    { leads: [LEAD] });
  const t = textoAviso(calls);
  check(t.includes('+56942327952'), 'el número a llamar va primero (es la acción)', t);
  check(t.includes('Levo SL S-Works'), 'dice qué bici vio', t);
  check(t.includes('vio:'), 'con el histórico de intereses del CRM', t);
  check(t.includes('precio es conversable'), 'y qué preguntó', t);
  check(out?.contexto && out.contexto.length > 0, 'el contexto también viaja en la respuesta', out?.contexto);
}

// ── 4 · Fuera de horario: no suena, pero NO se pierde ───────────────────────
console.log('\n── 4 · Fuera de horario (la red)');
{
  const { out, calls } = await run(
    { handle: 'nspringm2020', telefono: '+56942327952' },
    { leads: [LEAD], ahora: FUERA });
  check(calls.llamPost !== null, 'el ticket SÍ se crea a las 2 de la madrugada', calls.llamPost);
  check(calls.sendFlow.length === 0, 'pero no se despierta a nadie', calls.sendFlow);
  check(out?.aviso === 'pendiente_de_briefing', 'y queda declarado como pendiente del briefing', out);
  check(!sello(calls), '🔴 el sello queda VACÍO — ese vacío ES la cola del briefing', calls.llamPatch);
}
{
  // El caso más sutil: vuelve de madrugada y su ticket YA tenía sello de ayer.
  // Si el sello se dejara puesto, el briefing no lo listaría y nadie sabría que volvió.
  const ayer = '2026-07-15T14:00:00Z';
  const { out, calls } = await run(
    { handle: 'nspringm2020', telefono: '+56942327952' },
    { leads: [LEAD], ahora: FUERA, abiertos: [{ id: 'recT', createdTime: '2026-07-10T12:00:00Z', fields: { Lead: ['recLEAD'], Salida: 'Llamada pendiente', 'Aviso equipo enviado': ayer } }] });
  check(out?.aviso === 'pendiente_de_briefing', 'vuelve de madrugada → pendiente de briefing', out);
  check(sello(calls)?.['Aviso equipo enviado'] === null, 'se BORRA el sello viejo para que el briefing lo vuelva a listar', calls.llamPatch);
}

// ── 5 · La cola se lee por Salida, y el contrato con ManyChat no cambió ─────
console.log('\n── 5 · Contrato');
{
  const { out, calls } = await run({ handle: 'nspringm2020', telefono: '+56942327952' }, { leads: [LEAD] });
  for (const k of ['llamadoId', 'leadId', 'biciNombre', 'llamarElLegible', 'aviso', 'promesaLlamada', 'dentroDeHorario']) {
    check(k in out, `la respuesta conserva «${k}» (lo mapea ManyChat)`, Object.keys(out));
  }
  check(calls.llamPost?.Salida === 'Llamada pendiente', 'el ticket nace ya en su columna del Kanban', calls.llamPost);
  check(calls.leadPatch.some(p => p['Fecha teléfono']), 'sella «Fecha teléfono» — la métrica #1 del negocio', calls.leadPatch);
}
{
  // Si el lead ya tenía fecha de teléfono, no se pisa: la cohorte de la semana
  // no puede reescribirse cuando alguien vuelve.
  const conFecha = { ...LEAD, fields: { ...LEAD.fields, 'Fecha teléfono': '2026-07-01T10:00:00Z' } };
  const { calls } = await run({ handle: 'nspringm2020', telefono: '+56942327952' }, { leads: [conFecha] });
  check(!calls.leadPatch.some(p => 'Fecha teléfono' in p), 'y NO la reescribe si ya existía', calls.leadPatch);
}

console.log('');
if (fail) { console.log(`FALLARON ${fail} de ${total}`); process.exit(1); }
console.log(`TODAS OK (${total} aserciones)`);
