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
  destinatarios, suscritosA, atiendenClientes, avisar, _resetEquipoCache,
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
{
  mockEquipo([{ Nombre: 'Gabriel', 'SID ManyChat': '333', Horario: '1-5@9-20', Recibe: ['Briefing'], Activo: true }]);
  const br = await destinatarios(ENV, 'briefing', MIERCOLES_23);
  check(br.sids.includes('333'), 'el briefing IGNORA el horario: sale a su hora aunque nadie esté en turno', br);
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

console.log('');
if (fail) { console.log(`FALLARON ${fail} de ${total}`); process.exit(1); }
console.log(`TODAS OK (${total} aserciones)`);
