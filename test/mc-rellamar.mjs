// Prueba mc-rellamar.js (el botón «Sí, llámenme») con Airtable y ManyChat
// simulados. Ejecuta el código REAL del endpoint.
//
// La aserción que más importa: en NINGUNA rama puede haber un POST a la colección
// `Llamados`. El requisito de Gabriel fue explícito — «no que se cree un registro
// nuevo sino que se mueva su registro ya creado» — y un ticket duplicado por
// persona ensucia la cola de Luis, rompe el dedup de mc-llamado y falsea la
// métrica de «nunca llamados».
import { onRequestPost } from '../functions/api/mc-rellamar.js';

const ENV = {
  AIRTABLE_TOKEN: 'r', AIRTABLE_WRITE_TOKEN: 'w',
  MANYCHAT_TOKEN: 'mc',
  FLOW_NS_LLAMADO: 'ns_llamado',
  FLOW_NS_AVISO_EQUIPO: 'ns_aviso',
  AVISO_LLAMADO_SIDS: '579628082,302195575',
  AVISO_EQUIPO_SIDS: '579628082',
};

// Hora de Chile controlada: 13:00 (dentro de franja) o 23:00 (fuera).
const DENTRO = '2026-07-15T17:00:00Z';
const FUERA  = '2026-07-16T03:00:00Z';

function mock({ lead, tickets }) {
  const calls = { postLlamados: 0, patch: [], sendFlow: [], setField: [] };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url), m = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s });

    if (u.includes('/Leads') && m === 'GET') return J({ records: lead ? [lead] : [] });
    if (/\/Llamados\?/.test(u) && m === 'GET') return J({ records: tickets });
    if (/\/Llamados$/.test(u) && m === 'POST') { calls.postLlamados++; return J({ id: 'recNUEVO' }); }
    if (/\/Llamados\//.test(u) && m === 'PATCH') { calls.patch.push(body.fields); return J({}); }
    if (u.includes('setCustomFieldByName')) { calls.setField.push(body); return J({}); }
    if (u.includes('sendFlow')) { calls.sendFlow.push(body); return J({}); }
    return J({});
  };
  return calls;
}

const LEAD = { id: 'recLEAD', fields: { Nombre: 'Nicolás Springmuller', 'MC subscriber id': '1979973583' } };
const ticket = (f, creado = '2026-08-05T19:40:03.000Z') => ({ id: 'recTICKET', createdTime: creado, fields: f });

async function run({ lead = LEAD, tickets = [], ahora = DENTRO }) {
  const calls = mock({ lead, tickets });
  const real = Date.now;
  Date.now = () => new Date(ahora).getTime();
  // El endpoint usa `new Date()` para la hora de Chile; se congela vía Date.
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(ahora); }
    static now() { return new RealDate(ahora).getTime(); }
  };
  try {
    const req = { url: 'https://x/api/mc-rellamar', json: async () => ({ handle: 'nspringm2020', subscriber_id: '1979973583' }) };
    const res = await onRequestPost({ request: req, env: ENV });
    return { out: await res.json(), calls };
  } finally { globalThis.Date = RealDate; Date.now = real; }
}

let fail = 0, total = 0;
const check = (ok, msg, extra) => {
  total++;
  console.log((ok ? 'OK   ' : 'FALLO') + ' · ' + msg + (ok ? '' : '  → ' + JSON.stringify(extra)));
  if (!ok) fail++;
};

// ── 1 · El caso feliz: no contestado, dentro de franja ───────────────────────
{
  const { out, calls } = await run({ tickets: [ticket({ Salida: 'No contestado', Estado: 'Llamada pendiente', Nombre: 'Nicolás', 'Teléfono': '+56942327952', Lead: ['recLEAD'] })] });
  check(out.accion === 'reencolado', 'reencola el ticket', out);
  check(calls.postLlamados === 0, '⛔ NO creó ningún registro nuevo', calls.postLlamados);
  check(calls.patch[0]?.['Salida'] === 'Llamada pendiente', 'devuelve la tarjeta a la primera columna', calls.patch[0]);
  check(calls.patch[0]?.['Estado'] === 'Llamada pendiente', 'sincroniza el Estado', calls.patch[0]);
  check(calls.patch[0]?.['Aviso salida enviado'] === null, 'limpia el sello del cliente (el rescate podrá repetirse)', calls.patch[0]);
  check(!!calls.patch[0]?.['Pidió rellamada'], 'registra que la persona lo pidió', calls.patch[0]);
  check(calls.patch[0]?.['Reaperturas'] === 1, 'cuenta la reapertura', calls.patch[0]);
  check(!!calls.patch[0]?.['Aviso equipo enviado'], 'SELLA: dentro de franja se avisó al equipo', calls.patch[0]);
  check(calls.sendFlow.some(f => f.flow_ns === 'ns_llamado'), 'mandó el aviso de llamado al equipo', calls.sendFlow);
}

// ── 2 · Fuera de franja: vuelve a la cola, sin avisar, sello vacío ───────────
// Es el requisito literal de Gabriel: «si hace click fuera de horario, no se
// envía el aviso al equipo sino que se incluye en el briefing de las mañanas».
{
  const { out, calls } = await run({ ahora: FUERA, tickets: [ticket({ Salida: 'No contestado', Estado: 'Llamada pendiente', Nombre: 'Nicolás', Lead: ['recLEAD'] })] });
  check(out.accion === 'reencolado', 'igual lo reencola', out);
  check(out.dentroDeFranja === false, 'sabe que está fuera de franja', out);
  check(calls.sendFlow.filter(f => f.flow_ns === 'ns_llamado').length === 0, 'NO avisa al equipo de noche', calls.sendFlow);
  check(calls.patch[0]?.['Aviso equipo enviado'] === null, 'deja el sello VACÍO → lo recoge el briefing', calls.patch[0]);
  check(calls.postLlamados === 0, '⛔ NO creó registro', calls.postLlamados);
}

// ── 3 · Segundo toque: idempotente ──────────────────────────────────────────
{
  const { out, calls } = await run({ tickets: [ticket({ Salida: 'Llamada pendiente', Estado: 'Llamada pendiente', Nombre: 'Nicolás', Lead: ['recLEAD'] })] });
  check(out.accion === 'ya_en_cola', 'detecta que ya estaba en la cola', out);
  check(calls.sendFlow.length === 0, 'NO manda un segundo WhatsApp al equipo', calls.sendFlow);
  check(calls.postLlamados === 0, '⛔ NO creó registro', calls.postLlamados);
}

// ── 4 · Ticket ya avanzado: no se toca ──────────────────────────────────────
// El peor caso posible sería sacar una visita agendada del Kanban: eso dispararía
// una SEGUNDA confirmación de visita al cliente.
{
  const { out, calls } = await run({ tickets: [ticket({ Salida: 'Visita agendada', Estado: 'Llamado', Nombre: 'Nicolás', Lead: ['recLEAD'] })] });
  check(out.accion === 'derivado_a_humano', 'deriva a una persona en vez de mover el ticket', out);
  check(calls.patch.length === 0, 'NO tocó el ticket agendado', calls.patch);
  check(calls.sendFlow.some(f => f.flow_ns === 'ns_aviso'), 'avisó al equipo por el canal de «humano requerido»', calls.sendFlow);
  check(calls.postLlamados === 0, '⛔ NO creó registro', calls.postLlamados);
}

// ── 5 · Sin ticket y sin lead: deriva, nunca inventa ────────────────────────
{
  const { out, calls } = await run({ tickets: [] });
  check(out.accion === 'derivado_a_humano' && out.motivo === 'sin_ticket', 'sin ticket → deriva', out);
  check(calls.postLlamados === 0, '⛔ NO creó registro', calls.postLlamados);
}
{
  const { out, calls } = await run({ lead: null, tickets: [] });
  check(out.accion === 'derivado_a_humano' && out.motivo === 'lead_no_encontrado', 'sin lead → deriva', out);
  check(calls.postLlamados === 0, '⛔ NO creó registro', calls.postLlamados);
}

// ── 6 · Rearme: si al equipo ya se le avisó hace poco, no se le avisa de nuevo ─
{
  const hace30min = new Date(new Date(DENTRO).getTime() - 30 * 60000).toISOString();
  const { out, calls } = await run({ tickets: [ticket({ Salida: 'No contestado', Estado: 'Llamada pendiente', Nombre: 'Nicolás', Lead: ['recLEAD'], 'Aviso equipo enviado': hace30min })] });
  check(out.aviso === 'omitido_rearme', 'respeta el rearme de 2 h', out);
  check(calls.sendFlow.filter(f => f.flow_ns === 'ns_llamado').length === 0, 'no vuelve a sonar', calls.sendFlow);
  check(calls.patch[0]?.['Aviso equipo enviado'] === hace30min, 'conserva el sello viejo', calls.patch[0]);
}

// ── 7 · Tope de insistencia ─────────────────────────────────────────────────
{
  const { out, calls } = await run({ tickets: [ticket({ Salida: 'No contestado', Estado: 'Llamada pendiente', Nombre: 'Nicolás', Lead: ['recLEAD'], 'Reaperturas': 3 })] });
  check(out.topeAlcanzado === true, 'marca el tope de reaperturas', out);
  check(calls.sendFlow.some(f => f.flow_ns === 'ns_aviso'), 'escala a una persona en vez de seguir el ciclo', calls.sendFlow);
  check(calls.postLlamados === 0, '⛔ NO creó registro', calls.postLlamados);
}

console.log('');
if (fail) { console.log(`FALLARON ${fail} de ${total}`); process.exit(1); }
console.log(`TODAS OK (${total} aserciones)`);
