// Prueba salida-llamado.js con Airtable y ManyChat simulados (fetch interceptado).
// Ejecuta el CÓDIGO REAL del archivo — no una copia.
import { readFileSync } from 'node:fs';

const P = new URL('../functions/api/salida-llamado.js', import.meta.url);
const src = readFileSync(P, 'utf-8').replace('export async function onRequestPost', 'async function onRequestPost');
const mod = new Function(`${src}; return onRequestPost;`)();

const ENV = {
  AIRTABLE_TOKEN: 'r', AIRTABLE_WRITE_TOKEN: 'w', MC_TOKEN: 'mc',
  FLOW_NS_CONFIRMACION: 'ns_conf', FLOW_NS_REGION: 'ns_reg',
  FLOW_NS_ENCARGO: 'ns_enc', FLOW_NS_NO_CONTESTA: 'ns_noc',
};

function mockFetch({ ticket, lead }) {
  const calls = { patchLead: null, patchTicket: null, sendFlow: [], setField: [], nuevaSolicitud: null };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url), m = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (u.includes('/Solicitudes') && m === 'POST') { calls.nuevaSolicitud = body.fields; return new Response(JSON.stringify({ id: 'recSOLI' }), { status: 200 }); }
    if (u.includes('/Llamados/') && m === 'GET') return new Response(JSON.stringify({ fields: ticket }), { status: 200 });
    if (u.includes('/Leads/') && m === 'GET')    return new Response(JSON.stringify({ fields: lead }), { status: 200 });
    if (u.includes('/Inventario/') && m === 'GET') return new Response(JSON.stringify({ fields: { Modelo: 'Levo SL S-Works' } }), { status: 200 });
    if (u.includes('/Leads/') && m === 'PATCH')  { calls.patchLead = body.fields; return new Response('{}', { status: 200 }); }
    if (u.includes('/Llamados/') && m === 'PATCH') { calls.patchTicket = body.fields; return new Response('{}', { status: 200 }); }
    if (u.includes('setCustomFieldByName')) { calls.setField.push(body); return new Response('{}', { status: 200 }); }
    if (u.includes('sendFlow')) { calls.sendFlow.push(body); return new Response('{}', { status: 200 }); }
    return new Response('{}', { status: 200 });
  };
  return calls;
}

const run = async (ticket, lead) => {
  const calls = mockFetch({ ticket, lead });
  const req = { url: 'https://x/api/salida-llamado', json: async () => ({ llamadoId: 'recTICKET' }) };
  const res = await mod({ request: req, env: ENV });
  return { out: await res.json(), calls };
};

const LEAD_BASE = { 'MC subscriber id': '123', Estado: 'ficha_entregada' };
let fail = 0;
const check = (ok, msg, extra) => { console.log((ok ? 'OK   ' : 'FALLO') + ' · ' + msg + (ok ? '' : '  → ' + JSON.stringify(extra))); if (!ok) fail++; };

// 1 · Visita agendada con permiso → propaga permiso, copia visita, limpia sellos, avanza estado, manda flujo
{
  const { out, calls } = await run(
    { Salida: 'Visita agendada', 'Permiso WhatsApp': true, Lead: ['recL'], 'Fecha y hora de visita': '2026-07-30T18:30:00.000Z', 'Bici de interés': ['recB'] },
    { ...LEAD_BASE });
  check(out.mensaje === 'enviado', 'visita: manda el mensaje', out);
  check(calls.patchLead['Opt-in WhatsApp'] === true, 'visita: PROPAGA EL PERMISO al lead', calls.patchLead);
  check(calls.patchLead['Fecha visita'] === '2026-07-30T18:30:00.000Z', 'visita: copia la fecha al lead', calls.patchLead);
  check(calls.patchLead['Recordatorio 48h'] === null, 'visita: limpia sellos de recordatorio', calls.patchLead);
  check(calls.patchLead['Estado'] === 'visita_agendada', 'visita: avanza el estado del lead', calls.patchLead);
  check(calls.sendFlow[0]?.flow_ns === 'ns_conf', 'visita: usa el flujo de confirmación', calls.sendFlow);
  check(calls.setField.some(f => f.field_name === 'cf_bici' && f.field_value === 'Levo SL S-Works'), 'visita: puebla cf_bici con el modelo real', calls.setField);
  check(!!calls.patchTicket?.['Aviso salida enviado'], 'visita: sella idempotencia', calls.patchTicket);
}
// 2 · Idempotencia: ya enviado → no vuelve a mandar
{
  const { out, calls } = await run(
    { Salida: 'Visita agendada', 'Permiso WhatsApp': true, Lead: ['recL'], 'Aviso salida enviado': '2026-07-27T10:00:00.000Z' },
    { ...LEAD_BASE });
  check(out.accion === 'ya_enviado' && calls.sendFlow.length === 0, 'idempotencia: NO reenvía', out);
}
// 3 · Sin permiso → no manda, pero igual escribe el lead
{
  const { out, calls } = await run(
    { Salida: 'Encargo de búsqueda', 'Permiso WhatsApp': false, Lead: ['recL'] }, { ...LEAD_BASE });
  check(out.mensaje === 'sin_permiso' && calls.sendFlow.length === 0, 'sin permiso: no manda nada', out);
  // El Estado SÍ se sincroniza (Luis ya no lo toca), pero el sello NO: sin sello,
  // el aviso se reintenta cuando Luis marque el permiso.
  check(!calls.patchTicket?.['Aviso salida enviado'], 'sin permiso: NO sella (queda reintentable)', calls.patchTicket);
}
// 4 · No contestado → manda SIN permiso (excepción deliberada)
{
  const { out, calls } = await run(
    { Salida: 'No contestado', Lead: ['recL'], 'Bici de interés': ['recB'] }, { ...LEAD_BASE });
  check(out.mensaje === 'enviado' && calls.sendFlow[0]?.flow_ns === 'ns_noc', 'no contestado: manda sin permiso previo', out);
  check(calls.patchLead['Opt-in WhatsApp'] === undefined, 'no contestado: NO marca opt-in falsamente', calls.patchLead);
}
// 5 · Región con permiso
{
  const { out } = await run({ Salida: 'Coordinación región', 'Permiso WhatsApp': true, Lead: ['recL'] }, { ...LEAD_BASE });
  check(out.mensaje === 'enviado' && out.permisoPropagado === true, 'región: manda y propaga permiso', out);
}
// 6 · Guarda de no-regresión: lead ya cerró → no retrocede a visita_agendada
{
  const { calls } = await run(
    { Salida: 'Visita agendada', 'Permiso WhatsApp': true, Lead: ['recL'], 'Fecha y hora de visita': '2026-07-30T18:30:00.000Z' },
    { ...LEAD_BASE, Estado: 'cerró' });
  check(calls.patchLead['Estado'] === undefined, 'no-regresión: un lead cerrado NO retrocede', calls.patchLead);
}
// 7 · Sin salida marcada → no hace nada
{
  const { out, calls } = await run({ Lead: ['recL'] }, { ...LEAD_BASE });
  check(out.accion === 'sin_salida' && calls.sendFlow.length === 0, 'sin salida: no hace nada', out);
}
// 8 · Falta la env del flujo → lo dice, no muere en silencio
{
  const calls = mockFetch({ ticket: { Salida: 'Coordinación región', 'Permiso WhatsApp': true, Lead: ['recL'] }, lead: { ...LEAD_BASE } });
  const res = await mod({ request: { url: 'https://x/api/salida-llamado', json: async () => ({ llamadoId: 'r' }) },
    env: { ...ENV, FLOW_NS_REGION: '' } });
  const out = await res.json();
  check(out.mensaje === 'falta_env:FLOW_NS_REGION', 'env faltante: lo reporta explícito', out);
}

// 9 · Sincronía del ticket: Luis solo arrastra la tarjeta, el Estado lo pone el endpoint
{
  const { out, calls } = await run(
    { Salida: 'Visita agendada', 'Permiso WhatsApp': true, Lead: ['recL'], Estado: 'Llamada pendiente',
      'Fecha y hora de visita': '2026-07-30T18:30:00.000Z' }, { ...LEAD_BASE });
  check(calls.patchTicket?.['Estado'] === 'Llamado', 'ticket: visita → Estado pasa a Llamado', calls.patchTicket);
  check(out.estadoTicket === 'Llamado', 'ticket: lo reporta en la respuesta', out);
}
// 10 · «No contestado» NO cierra el ticket: vuelve a la cola de reintentos
{
  const { calls } = await run(
    { Salida: 'No contestado', Lead: ['recL'], Estado: 'Llamado', 'Bici de interés': ['recB'] }, { ...LEAD_BASE });
  check(calls.patchTicket?.['Estado'] === 'Llamada pendiente', 'no contestado: el ticket VUELVE a la cola', calls.patchTicket);
}
// 11 · «Sin interés» cierra sin mandar nada, a propósito
{
  const { out, calls } = await run({ Salida: 'Sin interés', Lead: ['recL'] }, { ...LEAD_BASE });
  check(out.mensaje === 'sin_mensaje_por_diseño', 'sin interés: no manda mensaje', out);
  check(calls.sendFlow.length === 0, 'sin interés: cero envíos', calls.sendFlow);
  check(calls.patchTicket?.['Estado'] === 'Cerrada', 'sin interés: cierra el ticket', calls.patchTicket);
  check(!!calls.patchTicket?.['Aviso salida enviado'], 'sin interés: sella igual (no reintentar)', calls.patchTicket);
}
// 12 · El token de ManyChat se lee de MANYCHAT_TOKEN (la variable que usan las otras 8 funciones)
{
  const calls = mockFetch({ ticket: { Salida: 'Coordinación región', 'Permiso WhatsApp': true, Lead: ['recL'] }, lead: { ...LEAD_BASE } });
  const { MANYCHAT_TOKEN, ...sinToken } = { ...ENV, MANYCHAT_TOKEN: 'mc' };
  const res = await mod({ request: { url: 'https://x/api/salida-llamado', json: async () => ({ llamadoId: 'r' }) },
    env: { ...sinToken, MANYCHAT_TOKEN: 'mc-real', MC_TOKEN: undefined } });
  const out = await res.json();
  check(out.mensaje === 'enviado', 'usa MANYCHAT_TOKEN (no MC_TOKEN, que no existe en Cloudflare)', out);
}

// 12-bis · Visita: las bicis a preparar se copian al Lead (máx 3) para el briefing
{
  const { calls } = await run(
    { Salida: 'Visita agendada', 'Permiso WhatsApp': true, Lead: ['recL'],
      'Fecha y hora de visita': '2026-07-30T18:30:00.000Z',
      'Bicis para la visita': ['recB1', 'recB2'] }, { ...LEAD_BASE });
  check(calls.patchLead?.['MC bici'] === 'Levo SL S-Works · Levo SL S-Works',
    'visita: copia las bicis a preparar al Lead', calls.patchLead);
}
// 12-ter · Si Luis no eligió ninguna, cae a la bici del reel (siempre hay algo que preparar)
{
  const { calls } = await run(
    { Salida: 'Visita agendada', 'Permiso WhatsApp': true, Lead: ['recL'],
      'Fecha y hora de visita': '2026-07-30T18:30:00.000Z',
      'Bici de interés': ['recB'] }, { ...LEAD_BASE });
  check(calls.patchLead?.['MC bici'] === 'Levo SL S-Works', 'visita sin selección: cae a la bici del reel', calls.patchLead);
}

// 13 · Encargo → nace el ticket de búsqueda y queda enlazado (cierra el circuito)
{
  const { out, calls } = await run(
    { Salida: 'Encargo de búsqueda', 'Permiso WhatsApp': true, Lead: ['recL'],
      'Modelo buscado': 'Levo SL2 talla S3', 'Teléfono': '+56912345678',
      Ciudad: 'Ñuñoa', 'Estatura (cm)': 178, Notas: 'Busca hasta $6M' },
    { ...LEAD_BASE });
  check(!!calls.nuevaSolicitud, 'encargo: CREA el ticket en Solicitudes', out);
  check(calls.nuevaSolicitud?.['Modelo buscado'] === 'Levo SL2 talla S3', 'encargo: copia qué busca', calls.nuevaSolicitud);
  check(calls.nuevaSolicitud?.['Contacto'] === '+56912345678', 'encargo: copia el teléfono', calls.nuevaSolicitud);
  check(calls.nuevaSolicitud?.['Estado'] === 'Llamada pendiente', 'encargo: entra a la cola de sourcing', calls.nuevaSolicitud);
  check(/Ñuñoa/.test(calls.nuevaSolicitud?.['Notas'] || ''), 'encargo: arrastra ciudad y contexto a las notas', calls.nuevaSolicitud);
  check(calls.patchTicket?.['Solicitud']?.[0] === 'recSOLI', 'encargo: enlaza el ticket de vuelta', calls.patchTicket);
  check(out.solicitudCreada === 'recSOLI', 'encargo: lo reporta en la respuesta', out);
}
// 14 · Guarda anti-duplicado: si ya tiene Solicitud, no crea otra
{
  const { calls } = await run(
    { Salida: 'Encargo de búsqueda', 'Permiso WhatsApp': true, Lead: ['recL'],
      'Modelo buscado': 'Epic 8', Solicitud: ['recYA'] }, { ...LEAD_BASE });
  check(calls.nuevaSolicitud === null, 'encargo repetido: NO crea una segunda solicitud', calls.nuevaSolicitud);
}
// 15 · Sin modelo escrito, el ticket igual nace (mejor incompleto que perdido)
{
  const { calls } = await run(
    { Salida: 'Encargo de búsqueda', 'Permiso WhatsApp': true, Lead: ['recL'] }, { ...LEAD_BASE });
  check(calls.nuevaSolicitud?.['Modelo buscado'] === '(por confirmar con el cliente)', 'encargo sin modelo: nace igual, marcado', calls.nuevaSolicitud);
}
// 16 · Las otras salidas NO crean solicitud
{
  const { calls } = await run({ Salida: 'Visita agendada', 'Permiso WhatsApp': true, Lead: ['recL'] }, { ...LEAD_BASE });
  check(calls.nuevaSolicitud === null, 'visita: no toca la cola de sourcing', calls.nuevaSolicitud);
}

console.log(fail === 0 ? `\nTODAS OK (${35} aserciones)` : `\n${fail} FALLOS`);
process.exit(fail === 0 ? 0 : 1);
