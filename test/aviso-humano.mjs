// Prueba `aviso-humano` — LA ENTRADA COMÚN de «esto necesita a una persona».
//
// Lo que se prueba, en una línea: que un mensaje que el bot no entendió NO se
// pierda, venga del canal que venga y sea la hora que sea.
import { onRequestPost, avisarHumano } from '../functions/api/aviso-humano.js';
import { _resetEquipoCache } from '../lib/avisos.js';

let fail = 0, total = 0;
const check = (ok, msg, extra) => {
  total++;
  console.log((ok ? 'OK   ' : 'FALLO') + ' · ' + msg + (ok ? '' : '  → ' + JSON.stringify(extra)));
  if (!ok) fail++;
};

const RealDate = Date;
const congelar = (iso) => {
  const t = new RealDate(iso).getTime();
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (!a.length) super(t); else super(...a); }
    static now() { return t; }
  };
};
const descongelar = () => { globalThis.Date = RealDate; };
const DENTRO = '2026-07-15T17:00:00Z';   // 13:00 Chile
const FUERA = '2026-07-16T06:00:00Z';    // 02:00 Chile

const ENV = {
  AIRTABLE_TOKEN: 'r', AIRTABLE_WRITE_TOKEN: 'w',
  MANYCHAT_TOKEN: 'mc', FLOW_NS_AVISO_EQUIPO: 'ns_aviso',
  AVISO_EQUIPO_SIDS: '111', AVISO_FRANJA: '9-20',
};

const LEAD_WA = {
  id: 'recLEADWA',
  fields: { Nombre: 'Pablo', 'MC subscriber id': '99887766', Estado: 'nuevo', Intereses: ['recI1'] },
};

function mock({ leads = [], equipo = null } = {}) {
  _resetEquipoCache();
  const calls = { avisoPost: null, setField: [], sendFlow: [] };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url), m = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
    if (u.includes('/Equipo')) return equipo ? J({ records: equipo.map((f, i) => ({ id: `recE${i}`, fields: f })) }) : J({ error: 'x' }, 404);
    if (/\/Leads\?/.test(u)) return J({ records: leads });
    if (/\/Leads\/rec/.test(u)) return J({ fields: leads[0]?.fields || {} });
    if (/\/Avisos$/.test(u) && m === 'POST') { calls.avisoPost = body.fields; return J({ id: 'recAVISO' }); }
    if (/\/Intereses\/rec/.test(u)) return J({ fields: { Bici: ['recBICI'], Resultado: 'Ficha entregada', Fecha: '2026-07-10' } });
    if (/\/Inventario\/rec/.test(u)) return J({ fields: { Modelo: 'Kenevo Expert' } });
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
      request: { url: 'https://x/api/aviso-humano', json: async () => payload },
      env,
    });
    return { status: res.status, out: await res.json(), calls };
  } finally { descongelar(); }
}

const texto = (calls) => (calls.setField.find(f => f.field_name === 'cf_aviso_datos') || {}).field_value || '';

// ── 1 · Identidad multicanal ────────────────────────────────────────────────
console.log('\n── 1 · El aviso de WhatsApp deja de nacer huérfano');
{
  // 🔴 Antes esto resolvía el Lead SÓLO por `@handle IG`. En WhatsApp ese campo no
  // existe, así que TODO aviso de WhatsApp quedaba sin Lead: fuera del rollup
  // «Terminó en venta» y sin contexto para quien tuviera que responder.
  const { out, calls } = await run(
    { subscriber_id: '99887766', canal: 'WhatsApp', motivo: 'el bot no entendió el mensaje', mensaje: 'tienen algo para mi hijo de 12' },
    { leads: [LEAD_WA] });
  check(calls.avisoPost?.Lead?.[0] === 'recLEADWA', 'enlaza el Lead por subscriber_id (no sólo por @handle)', calls.avisoPost);
  check(calls.avisoPost?.['Subscriber ID'] === '99887766', 'guarda el Subscriber ID: es cómo se encuentra la conversación', calls.avisoPost);
  check(calls.avisoPost?.Canal === 'WhatsApp', 'y el canal, para saber por dónde responder', calls.avisoPost);
  check(texto(calls).includes('respóndele por WhatsApp'), 'el mensaje al equipo trae la acción pendiente', texto(calls));
  check(texto(calls).includes('Kenevo Expert'), 'y el contexto: qué bici había visto', texto(calls));
  check(out?.registro === 'registrado' && out?.aviso === 'enviado', 'registra y avisa', out);
  check(calls.avisoPost?.Salida === 'Pendiente',
    'nace en la primera columna del Kanban «6 · Falta responder» (no en la pila sin categoría)', calls.avisoPost);
}
{
  const { calls } = await run(
    { handle: '@paljaro', canal: 'DM IG', motivo: 'el bot no entendió el mensaje', mensaje: 'Quiero una bicicleta de entrada' },
    { leads: [] });
  check(calls.avisoPost?.['@handle IG'] === 'paljaro', 'Instagram sigue funcionando igual, sin arroba', calls.avisoPost);
  check(!calls.avisoPost?.Lead, 'sin lead en el CRM no inventa uno (crearlo sin canal lo mandaría a la puerta equivocada)', calls.avisoPost);
  check(calls.avisoPost?.Resumen?.includes('Quiero una bicicleta'), 'el resumen cita lo que dijo la persona', calls.avisoPost?.Resumen);
}

// ── 2 · Fuera de horario: la red ────────────────────────────────────────────
console.log('\n── 2 · Fuera de horario');
{
  const { out, calls } = await run(
    { subscriber_id: '99887766', canal: 'WhatsApp', motivo: 'el bot no entendió el mensaje', mensaje: 'hola' },
    { leads: [LEAD_WA], ahora: FUERA });
  check(calls.sendFlow.length === 0, 'a las 2 AM no se despierta a nadie', calls.sendFlow);
  check(calls.avisoPost !== null, 'pero el aviso QUEDA REGISTRADO igual', calls.avisoPost);
  check(!('Aviso equipo enviado' in (calls.avisoPost || {})), '🔴 sin sello — ese vacío es lo que lo mete al briefing de mañana', calls.avisoPost);
  check(calls.avisoPost?.Resuelto === false, 'y nace sin resolver, que es lo que lo mantiene en la cola', calls.avisoPost);
  check(out?.aviso === 'pendiente_de_briefing', 'lo declara en la respuesta', out);
}
{
  // El escape para volver al comportamiento anterior a 2026-08-19.
  const { out, calls } = await run(
    { subscriber_id: '99887766', canal: 'WhatsApp', motivo: 'x' },
    { leads: [LEAD_WA], ahora: FUERA, env: { ...ENV, AVISO_HUMANO_24H: '1' } });
  check(calls.sendFlow.length === 1 && out?.aviso === 'enviado', 'con AVISO_HUMANO_24H=1 suena igual a las 2 AM', out);
  check(calls.avisoPost?.['Aviso equipo enviado'], 'y entonces sí se sella', calls.avisoPost);
}

// ── 3 · El registro nunca depende del envío ─────────────────────────────────
console.log('\n── 3 · El registro es independiente del WhatsApp');
{
  const { out, calls } = await run(
    { handle: 'alguien', canal: 'DM IG', motivo: 'el bot no entendió el mensaje' },
    { leads: [], env: { AIRTABLE_TOKEN: 'r', AIRTABLE_WRITE_TOKEN: 'w' } });   // sin envs de ManyChat
  check(calls.avisoPost !== null, 'sin plantilla ni envs de ManyChat, igual se registra', calls.avisoPost);
  check(calls.avisoPost?.['WhatsApp enviado'] === false, 'marcado honestamente como NO enviado', calls.avisoPost);
  check(out?.registro === 'registrado', 'la métrica de «cuántas veces el bot necesitó un humano» no se pierde', out);
}

// ── 3-bis · La promesa al cliente ───────────────────────────────────────────
console.log('\n── 3-bis · El bot ya puede decir CUÁNDO le responden');
{
  // Antes no prometía plazo a propósito, porque no sabía calcularlo. Ahora sale
  // del horario de quien ATIENDE (Luis y Juan Alfonso), no de quien recibe.
  const equipo = [
    { Nombre: 'Luis', 'SID ManyChat': '111', Horario: '1,3-5@9-20|6@9-15', Recibe: ['Humano'], Activo: true, 'Atiende clientes': true },
    { Nombre: 'Juan Alfonso', 'SID ManyChat': '', Horario: '2@9-20', Recibe: ['Humano'], Activo: true, 'Atiende clientes': true },
    { Nombre: 'Roberto', 'SID ManyChat': '222', Horario: '*@8-20', Recibe: ['Humano'], Activo: true, 'Atiende clientes': false },
  ];
  // Domingo 03:00 en Chile = 07:00Z del domingo (UTC-4 en julio).
  const { out } = await run({ handle: 'x', canal: 'WhatsApp', motivo: 'el bot no entendió el mensaje' },
    { leads: [], equipo, ahora: '2026-07-19T07:00:00Z' });
  check(out?.promesa === 'mañana lunes a partir de las 9:00',
    '🔴 domingo 3 AM → «mañana lunes a partir de las 9:00» (el ejemplo de Gabriel)', out?.promesa);
  check(out?.dentroDeHorario === false, 'y declara que ahora no hay nadie atendiendo', out);
}
{
  const equipo = [{ Nombre: 'Luis', 'SID ManyChat': '111', Horario: '*@0-24', Recibe: ['Humano'], Activo: true, 'Atiende clientes': true }];
  const { out } = await run({ handle: 'x', canal: 'DM IG', motivo: 'x' }, { leads: [], equipo });
  check(out?.promesa === 'en un rato', 'con alguien atendiendo, la respuesta por chat promete «en un rato»', out?.promesa);
}

// ── 4 · La misma entrada la usa el backend ──────────────────────────────────
console.log('\n── 4 · `avisarHumano` es la entrada común también para el backend');
{
  const calls = mock({ leads: [LEAD_WA] });
  congelar(DENTRO);
  const out = await avisarHumano(ENV, {
    subId: '99887766', canal: 'WhatsApp',
    motivo: 'apretó «Sí, llámenme» pero su ticket ya está en «Visita agendada»',
  });
  descongelar();
  check(out.registro === 'registrado', 'los avisos que nacen dentro del backend también quedan en la tabla', out);
  check(calls.avisoPost?.Motivo?.includes('Sí, llámenme'), 'con su motivo', calls.avisoPost);
  check(out.enviados === 1, 'y salen por el mismo canal', out);
}

console.log('');
if (fail) { console.log(`FALLARON ${fail} de ${total}`); process.exit(1); }
console.log(`TODAS OK (${total} aserciones)`);
