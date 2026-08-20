// Prueba el horario POR PERSONA (tabla `Equipo`) de lib/avisos.js.
//
// Pedido de Gabriel (2026-08-19): «se envíe un wsp con la información de mensaje
// y el canal bajo un horario determinado que es distinto para cada persona».
//
// Lo delicado de esto no es el horario: es que el 2026-08-06 se BORRÓ la lógica
// por persona precisamente porque vivía copiada seis veces en dos dialectos
// incompatibles. Volver a tenerla sólo es seguro si vive en UN lugar y si, cuando
// la tabla no existe, el sistema se comporta EXACTAMENTE como antes. Eso es lo
// que se prueba acá.
import {
  parseHorarioPersona, enHorarioPersona, horarioUnion,
  destinatarios, suscritosA, atiendenClientes, avisar, quedaPendiente, _resetEquipoCache,
} from '../lib/avisos.js';

let fail = 0, total = 0;
const check = (ok, msg, extra) => {
  total++;
  console.log((ok ? 'OK   ' : 'FALLO') + ' · ' + msg + (ok ? '' : '  → ' + JSON.stringify(extra)));
  if (!ok) fail++;
};

// Chile es UTC-4 en julio. 17:00Z = 13:00 (miércoles 15-jul-2026).
const MIERCOLES_13 = new Date('2026-07-15T17:00:00Z');
const MIERCOLES_23 = new Date('2026-07-16T03:00:00Z');   // 23:00 del miércoles
const DOMINGO_13  = new Date('2026-07-19T17:00:00Z');

// Mock de Airtable: devuelve las filas de `Equipo` que le pasemos, o 404 si null.
function mockEquipo(filas) {
  _resetEquipoCache();
  globalThis.fetch = async (url) => {
    if (String(url).includes('/Equipo')) {
      if (!filas) return new Response('{"error":"NOT_FOUND"}', { status: 404 });
      return new Response(JSON.stringify({ records: filas.map((f, i) => ({ id: `rec${i}`, fields: f })) }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
}

const ENV = { AIRTABLE_TOKEN: 'r', AVISO_LLAMADO_SIDS: '111,222', BRIEFING_SIDS: '999', AVISO_FRANJA: '9-20' };

// ── 1 · El formato del horario ──────────────────────────────────────────────
console.log('\n── 1 · parseHorarioPersona');
check(JSON.stringify(parseHorarioPersona('1-5@9-20')) === '{"1":[9,20],"2":[9,20],"3":[9,20],"4":[9,20],"5":[9,20]}', 'rango de días');
check(JSON.stringify(parseHorarioPersona('*@9-20')) === '{"0":[9,20],"1":[9,20],"2":[9,20],"3":[9,20],"4":[9,20],"5":[9,20],"6":[9,20]}', 'asterisco = todos');
check(JSON.stringify(parseHorarioPersona('1,3,5@10-18')) === '{"1":[10,18],"3":[10,18],"5":[10,18]}', 'días sueltos con coma');
check(JSON.stringify(parseHorarioPersona('1-5@9-20|6@10-14')) === '{"1":[9,20],"2":[9,20],"3":[9,20],"4":[9,20],"5":[9,20],"6":[10,14]}', 'dos bloques');
check(parseHorarioPersona('') === null, 'vacío → null (usa la franja general)');
check(parseHorarioPersona('basura') === null, 'basura → null, NO un horario inventado');
check(parseHorarioPersona('1@20-9') === null, 'desde >= hasta → null (no se acepta a medias)');

console.log('\n── 2 · enHorarioPersona · `hasta` es EXCLUSIVO');
check(enHorarioPersona('3@9-20', MIERCOLES_13, ENV) === true, 'miércoles 13:00 dentro de 9-20');
check(enHorarioPersona('3@9-20', MIERCOLES_23, ENV) === false, 'miércoles 23:00 fuera');
check(enHorarioPersona('1-2@9-20', MIERCOLES_13, ENV) === false, 'el miércoles no está en su rango de días');
check(enHorarioPersona('3@9-13', MIERCOLES_13, ENV) === false, '13:00 con cierre a las 13 → FUERA (el corte declarado es el real)');
check(enHorarioPersona('', MIERCOLES_13, ENV) === true, 'sin horario propio cae a la franja general (9-20)');
check(enHorarioPersona('', MIERCOLES_23, ENV) === false, 'sin horario propio, a las 23:00 la franja general dice que no');

console.log('\n── 3 · horarioUnion · el turno del equipo, para la promesa al cliente');
check(horarioUnion([{ horario: '1@9-19' }, { horario: '1@10-21' }]) === '1@9-21', 'toma el bloque más amplio del día');
check(horarioUnion([{ horario: '1@9-19' }, { horario: '2@10-21' }]) === '1@9-19|2@10-21', 'días distintos se suman');
check(horarioUnion([]) === '', 'sin gente, sin horario');

// ── 4 · A quién le toca ─────────────────────────────────────────────────────
console.log('\n── 4 · destinatarios · con tabla Equipo');
{
  mockEquipo([
    { Nombre: 'Luis', 'SID ManyChat': '111', Horario: '1-6@9-20', Recibe: ['Llamadas', 'Briefing'], Activo: true },
    { Nombre: 'Roberto', 'SID ManyChat': '222', Horario: '1-5@9-13', Recibe: ['Llamadas'], Activo: true },
  ]);
  const a = await destinatarios(ENV, 'llamada', MIERCOLES_13);
  check(a.fuente === 'equipo', 'la tabla manda sobre las envs', a);
  check(a.sids.length === 1 && a.sids[0] === '111', 'a las 13:00 sólo Luis (Roberto cierra a las 13, exclusivo)', a);
  check(a.fuera.includes('Roberto'), 'Roberto queda listado como fuera de turno', a);

  const b = await destinatarios(ENV, 'llamada', MIERCOLES_23);
  check(b.sids.length === 0 && b.fuera.length === 2, 'a las 23:00 no hay nadie, y los dos quedan como fuera', b);
}
{
  // 🔴 La red: sin nadie en turno, `avisar` responde `fuera_de_horario` — que es
  // la señal que hace que el emisor NO selle y que el briefing lo recoja mañana.
  // Si esto devolviera `no_configurado`, el caso se contaría como error y se
  // gastarían los 3 intentos de madrugada.
  const r = await avisar(ENV, { tipo: 'llamada', flowEnv: 'FLOW_NS_LLAMADO', campo: 'cf', texto: 'x', now: MIERCOLES_23 });
  check(r.enviados === 0 && r.motivo === 'fuera_de_horario', 'sin nadie en turno → fuera_de_horario, no error', r);
}
{
  mockEquipo([{ Nombre: 'Luis', 'SID ManyChat': '111', Horario: '1-6@9-20', Recibe: ['Llamadas'], Activo: true }]);
  const br = await destinatarios(ENV, 'briefing', MIERCOLES_23);
  check(br.fuente === 'env' && br.sids.includes('999'),
    'nadie suscrito a Briefing en la tabla → cae a BRIEFING_SIDS (fallback POR TIPO)', br);
}
// ── El briefing mira el DÍA, no la HORA (2026-08-20) ────────────────────────
// Si mirara la hora, alguien cuyo turno empieza a las 10:00 nunca recibiría el
// briefing de las 9:00. Si no mirara nada, quien cubre sólo los martes recibiría
// seis resúmenes inútiles por semana. La pregunta correcta es «¿trabajas hoy?».
{
  mockEquipo([{ Nombre: 'Gabriel', 'SID ManyChat': '333', Horario: '1-5@9-20', Recibe: ['Briefing'], Activo: true }]);
  const br = await destinatarios(ENV, 'briefing', MIERCOLES_23);
  check(br.sids.includes('333'), 'el briefing NO mira la hora: el miércoles a las 23:00 igual entra', br);
}
{
  // El equipo real: Luis no trabaja martes ni domingo; Juan Alfonso sólo el martes.
  const equipo = [
    { Nombre: 'Luis', 'SID ManyChat': '111', Horario: '1,3-5@9-20|6@9-15', Recibe: ['Briefing'], Activo: true },
    { Nombre: 'Juan Alfonso', 'SID ManyChat': '222', Horario: '2@9-20', Recibe: ['Briefing'], Activo: true },
    { Nombre: 'Roberto', 'SID ManyChat': '333', Horario: '*@8-20', Recibe: ['Briefing'], Activo: true },
  ];
  const NUEVE = (dia) => { const b = new Date(Date.UTC(2026, 6, 26, 13, 0, 0)); b.setUTCDate(b.getUTCDate() + dia); return b; };
  const quien = async (dia) => { mockEquipo(equipo); return (await destinatarios(ENV, 'briefing', NUEVE(dia))).personas.sort().join(','); };
  check(await quien(2) === 'Juan Alfonso,Roberto', '🔴 el MARTES el briefing va a Juan Alfonso y Roberto, no a Luis', await quien(2));
  check(await quien(3) === 'Luis,Roberto', 'el miércoles va a Luis y Roberto, no a Juan Alfonso', await quien(3));
  check(await quien(6) === 'Luis,Roberto', 'el sábado va a Luis y Roberto', await quien(6));
  check(await quien(0) === 'Roberto', 'el domingo sólo a quien trabaja todos los días', await quien(0));
}
{
  // Y la hora sigue sin importar: un turno que empieza a las 10 igual recibe el de las 9.
  mockEquipo([{ Nombre: 'Tarde', 'SID ManyChat': '444', Horario: '1-5@10-20', Recibe: ['Briefing'], Activo: true }]);
  const NUEVE_LUNES = new Date(Date.UTC(2026, 6, 27, 13, 0, 0));
  const br = await destinatarios(ENV, 'briefing', NUEVE_LUNES);
  check(br.sids.includes('444'), 'quien entra a las 10:00 igual recibe el briefing de las 9:00', br);
}
{
  mockEquipo([{ Nombre: 'Sin id', Horario: '*@0-24', Recibe: ['Llamadas'], Activo: true }]);
  const a = await destinatarios(ENV, 'llamada', MIERCOLES_13);
  check(a.sids.length === 0 && a.sinSid.includes('Sin id'),
    'una fila sin SID no rompe nada y queda REPORTADA (si no, es un silencio invisible)', a);
}

console.log('\n── 5 · La red de seguridad: sin tabla, todo como antes');
{
  mockEquipo(null);   // la tabla no existe
  const a = await destinatarios(ENV, 'llamada', MIERCOLES_13);
  check(a.fuente === 'env' && a.sids.join() === '111,222', 'sin tabla Equipo → envs de siempre', a);
  const b = await destinatarios(ENV, 'llamada', MIERCOLES_23);
  check(b.sids.length === 0, 'sin tabla Equipo → franja global 9-20, igual que antes', b);
  const d = await destinatarios(ENV, 'llamada', DOMINGO_13);
  check(d.sids.length === 2, 'sin tabla Equipo la franja no distingue días (decisión 2026-08-06)', d);
}
{
  mockEquipo([{ Nombre: 'Luis', 'SID ManyChat': '111', Horario: '1-6@9-20', Recibe: ['Llamadas'], Activo: false }]);
  const a = await destinatarios(ENV, 'llamada', MIERCOLES_13);
  check(a.fuente === 'env', 'con TODOS inactivos también cae a las envs (así se siembra la tabla sin efecto)', a);
  const s = await suscritosA(ENV, 'llamada');
  check(s.length === 0, 'suscritosA ignora a los inactivos', s);
}

// ── 6 · Quién atiende ≠ quién recibe (2026-08-20) ───────────────────────────
console.log('\n── 6 · «Atiende clientes» es una lista distinta de los destinatarios');
{
  // El equipo real: Luis y Juan Alfonso atienden; Gabriel y Roberto sólo reciben.
  mockEquipo([
    { Nombre: 'Luis', 'SID ManyChat': '579628082', Horario: '1,3-5@9-20|6@9-15', Recibe: ['Llamadas'], Activo: true, 'Atiende clientes': true },
    { Nombre: 'Juan Alfonso', 'SID ManyChat': '', Horario: '2@9-20', Recibe: ['Llamadas'], Activo: true, 'Atiende clientes': true },
    { Nombre: 'Roberto', 'SID ManyChat': '302195575', Horario: '*@8-20', Recibe: ['Llamadas'], Activo: true, 'Atiende clientes': false },
  ]);
  const atienden = await atiendenClientes(ENV);
  check(atienden.map(p => p.nombre).sort().join() === 'Juan Alfonso,Luis',
    'sólo Luis y Juan Alfonso cuentan para la promesa al cliente', atienden.map(p => p.nombre));
  check(atienden.some(p => p.nombre === 'Juan Alfonso'),
    '🔴 Juan Alfonso cuenta AUNQUE no tenga SID: el horario que se le promete al cliente depende de quién trabaja, no de quién está cableado en ManyChat', atienden);
  check(horarioUnion(atienden).includes('2@9-20'), 'y su martes entra en la unión', horarioUnion(atienden));
  check(!horarioUnion(atienden).includes('0@'), 'el domingo no lo cubre nadie, aunque Roberto reciba avisos ese día', horarioUnion(atienden));

  // Y en paralelo, los avisos SÍ le llegan a Roberto un domingo.
  const DOMINGO_10 = new Date('2026-07-19T14:00:00Z');   // domingo 10:00 en Chile
  const d = await destinatarios(ENV, 'llamada', DOMINGO_10);
  check(d.sids.join() === '302195575', 'el domingo a las 10 el aviso le llega a Roberto y a nadie más', d);
  check(d.fuera.includes('Luis'), 'y Luis queda anotado como fuera de turno', d);
}
{
  // Sin nadie marcado, la promesa cae al horario por defecto del código.
  mockEquipo([{ Nombre: 'X', 'SID ManyChat': '1', Horario: '*@0-24', Recibe: ['Llamadas'], Activo: true }]);
  const a = await atiendenClientes(ENV);
  check(a.length === 0 && horarioUnion(a) === '', 'sin nadie con «Atiende clientes», la unión va vacía y manda el default', a);
}

// ── 7 · Quién puede SELLAR (regresión cazada el 2026-08-20) ─────────────────
// 🔴 El sello significa «este caso está cubierto, no lo vuelvas a mandar», y se
// escribía en cuanto CUALQUIERA recibía el aviso. Con el equipo real eso resultó
// estar mal: Gabriel y Roberto reciben los avisos de llamadas para mirar el
// negocio pero NO llaman. Un lead del domingo les llegaba a ellos, el ticket
// quedaba sellado, y el lunes le aparecía a Luis marcado «esperando 20h» y
// ordenado DESPUÉS de los que nadie había visto: los leads más frescos quedaban
// sepultados bajo los más viejos. ~16 horas por semana, las de más tráfico.
console.log('\n── 7 · El sello exige que se entere alguien que ACTÚA');
const EQUIPO_REAL = [
  { Nombre: 'Luis', 'SID ManyChat': '111', Horario: '1,3-5@9-20|6@9-15', Recibe: ['Llamadas', 'Humano', 'Consignaciones'], Activo: true, 'Atiende clientes': true },
  { Nombre: 'Roberto', 'SID ManyChat': '222', Horario: '*@8-20', Recibe: ['Llamadas', 'Humano', 'Consignaciones'], Activo: true, 'Atiende clientes': false },
  { Nombre: 'Gabriel', 'SID ManyChat': '333', Horario: '*@8-20', Recibe: ['Llamadas', 'Humano', 'Consignaciones'], Activo: true, 'Atiende clientes': false },
];
const DOM13 = new Date("2026-07-19T17:00:00Z");   // domingo 13:00 · Luis no trabaja
const LUN13 = new Date('2026-07-20T17:00:00Z');     // lunes 13:00 · Luis sí
{
  mockEquipo(EQUIPO_REAL);
  const d = await destinatarios(ENV, 'llamada', DOM13);
  check(d.sids.length === 2, 'domingo: el aviso SÍ le llega a Gabriel y Roberto (lo pidieron)', d.personas);
  check((d.atienden || []).length === 0, '🔴 pero NINGUNO puede sellar: no llaman', d.atienden);
  check(d.soloObservan.sort().join() === 'Gabriel,Roberto', 'y quedan declarados como observadores', d.soloObservan);
}
{
  mockEquipo(EQUIPO_REAL);
  const d = await destinatarios(ENV, 'llamada', LUN13);
  check((d.atienden || []).join() === '111', 'el lunes sólo Luis puede sellar, aunque reciban los tres', d);
}
{
  // 🔴 Y en las colas donde el que ACTÚA es justamente Roberto, exigirle
  // «Atiende clientes» las dejaría sin sellar nunca → el barrido reenviaría
  // para siempre. Por eso la regla sólo aplica a los avisos de cara al cliente.
  mockEquipo(EQUIPO_REAL);
  const d = await destinatarios(ENV, 'consigna', DOM13);
  check((d.atienden || []).length === 2, 'en consignaciones cualquiera que reciba sella (Roberto es el que actúa)', d.atienden);
}

console.log('\n── 8 · `avisar` no sella cuando sólo miraron los observadores');
{
  mockEquipo(EQUIPO_REAL);
  globalThis.fetch = (orig => async (url, opts) => {
    if (String(url).includes('manychat')) return new Response('{}', { status: 200 });
    return orig(url, opts);
  })(globalThis.fetch);
  const r = await avisar({ ...ENV, MANYCHAT_TOKEN: 'mc', FLOW_NS_LLAMADO: 'ns' },
    { tipo: 'llamada', flowEnv: 'FLOW_NS_LLAMADO', campo: 'cf', texto: 'x', now: DOM13 });
  check(r.enviados === 2, 'el WhatsApp SALE igual: es lo que pidió Gabriel', r);
  check(r.puedeSellar === false, '🔴 pero puedeSellar = false → el ticket NO se sella', r);
  check(r.motivo === 'solo_observadores', 'y lo declara con un motivo propio', r.motivo);
  check(quedaPendiente(r.motivo), 'que cuenta como «sigue pendiente», no como fallo', r.motivo);
}
{
  mockEquipo(EQUIPO_REAL);
  globalThis.fetch = (orig => async (url, opts) => {
    if (String(url).includes('manychat')) return new Response('{}', { status: 200 });
    return orig(url, opts);
  })(globalThis.fetch);
  const r = await avisar({ ...ENV, MANYCHAT_TOKEN: 'mc', FLOW_NS_LLAMADO: 'ns' },
    { tipo: 'llamada', flowEnv: 'FLOW_NS_LLAMADO', campo: 'cf', texto: 'x', now: LUN13 });
  check(r.puedeSellar === true, 'el lunes, con Luis en turno, sí se sella', r);
}
{
  // Sin tabla Equipo no hay forma de distinguir: cualquiera sella, como siempre.
  mockEquipo(null);
  globalThis.fetch = (orig => async (url, opts) => {
    if (String(url).includes('manychat')) return new Response('{}', { status: 200 });
    return orig(url, opts);
  })(globalThis.fetch);
  const r = await avisar({ ...ENV, MANYCHAT_TOKEN: 'mc', FLOW_NS_LLAMADO: 'ns' },
    { tipo: 'llamada', flowEnv: 'FLOW_NS_LLAMADO', campo: 'cf', texto: 'x', now: LUN13 });
  check(r.puedeSellar === true, 'sin tabla Equipo el sello se comporta como antes', r);
}

console.log('');
if (fail) { console.log(`FALLARON ${fail} de ${total}`); process.exit(1); }
console.log(`TODAS OK (${total} aserciones)`);
