// Prueba la PROMESA que el bot le hace al cliente, ejecutando el código real.
// Verifica que nunca prometa una atención que el horario no permite: «te
// respondemos al tiro» a las 2 AM es una promesa rota, y una promesa rota hace
// más daño que no haber prometido nada.
//
// 🔴 LA DISTINCIÓN QUE SE PRUEBA ACÁ (2026-08-20): la promesa sale del horario de
// quien **atiende al cliente**, NO de quien recibe el aviso. Gabriel y Roberto
// reciben avisos todos los días de 8 a 20 para mirar el negocio; el que contesta
// es Luis (y Juan Alfonso los martes). Si la promesa saliera de los
// destinatarios, un domingo a las 10:00 el bot prometería respuesta ese mismo día.
import { promesaLlamada, parseHorario, resolverDia } from '../functions/api/aviso-llamada.js';
import { promesaAtencion, horarioUnion } from '../lib/avisos.js';

// Chile es UTC-4 en julio → se suman 4 h para pedir una hora local.
// 2026-07-26 fue domingo, así que dia=0 es domingo.
const chile = (dia, hora) => {
  const base = new Date(Date.UTC(2026, 6, 26, 0, 0, 0));
  base.setUTCDate(base.getUTCDate() + dia);
  base.setUTCHours(hora + 4);
  return base;
};

let fail = 0, total = 0;
const check = (got, esperado, msg) => {
  total++;
  const ok = got === esperado;
  console.log((ok ? 'OK   ' : 'FALLO') + ' · ' + msg + '  →  "' + got + '"' + (ok ? '' : `  (esperaba "${esperado}")`));
  if (!ok) fail++;
};
const checkOk = (ok, msg, extra) => {
  total++;
  console.log((ok ? 'OK   ' : 'FALLO') + ' · ' + msg + (ok ? '' : '  → ' + JSON.stringify(extra)));
  if (!ok) fail++;
};

// ── El horario REAL del equipo (Gabriel, 2026-08-20) ────────────────────────
//   Luis          lunes, miércoles a viernes 9-20 · sábado 9-15
//   Juan Alfonso  martes 9-20
//   (Gabriel y Roberto reciben avisos todos los días 8-20, pero NO atienden)
const ATIENDEN = [
  { horario: '1,3-5@9-20|6@9-15' },   // Luis
  { horario: '2@9-20' },              // Juan Alfonso
];
const EQUIPO = horarioUnion(ATIENDEN);
const p = (dia, hora, env = {}) => promesaLlamada(env, chile(dia, hora), EQUIPO).promesa;

console.log('\n── 0 · La unión de los turnos de quien atiende');
check(EQUIPO, '1@9-20|2@9-20|3@9-20|4@9-20|5@9-20|6@9-15', 'los dos turnos se suman y cubren de lunes a sábado');
checkOk(!EQUIPO.includes('0@'), 'el domingo NO queda cubierto por nadie', EQUIPO);

console.log('\n── 1 · Dentro de horario');
check(p(1, 11), 'en los próximos minutos', 'lunes 11:00 · Luis');
check(p(2, 11), 'en los próximos minutos', 'martes 11:00 · lo cubre Juan Alfonso');
check(p(6, 12), 'en los próximos minutos', 'sábado 12:00 · Luis hasta las 15');

console.log('\n── 2 · Fuera de horario · el caso que planteó Gabriel');
// «Si alguien escribe un domingo a las 3 AM, se le dice: ok, perfecto, nuestro
//  especialista te responderá mañana (lunes) apenas llegue.»
check(p(0, 3), 'mañana lunes a partir de las 9:00', '🔴 DOMINGO 3 AM → mañana LUNES (el ejemplo textual)');
check(p(0, 12), 'mañana lunes a partir de las 9:00', 'domingo al mediodía · nadie atiende los domingos');
check(p(1, 7), 'hoy a partir de las 9:00', 'lunes 07:00 · antes de abrir, hoy mismo');
check(p(1, 21), 'mañana martes a partir de las 9:00', 'lunes 21:00 · el martes lo cubre Juan Alfonso');
check(p(2, 21), 'mañana miércoles a partir de las 9:00', 'martes 21:00 · vuelve Luis');
check(p(5, 21), 'mañana sábado a partir de las 9:00', 'viernes 21:00 · sábado sí se atiende');
check(p(6, 16), 'el lunes a partir de las 9:00', 'sábado 16:00 · salta el domingo cerrado');

console.log('\n── 3 · La promesa NO sale de quien recibe los avisos');
// Gabriel y Roberto reciben todos los días de 8 a 20. Si contaran para la
// promesa, el domingo el bot prometería respuesta ese mismo día. No cuentan.
const CON_DESTINATARIOS = horarioUnion([...ATIENDEN, { horario: '*@8-20' }, { horario: '*@8-20' }]);
check(promesaLlamada({}, chile(0, 12), CON_DESTINATARIOS).promesa, 'en los próximos minutos',
  '(control) si contaran los destinatarios, el domingo diría que sí — por eso no cuentan');
check(p(0, 12), 'mañana lunes a partir de las 9:00', 'con el horario correcto, el domingo manda al lunes');

console.log('\n── 4 · Los dos usos comparten el cálculo y sólo cambian el texto de «ahora»');
check(promesaAtencion({}, chile(1, 11), EQUIPO, 'en un rato').promesa, 'en un rato',
  'respuesta por chat, en horario');
check(promesaAtencion({}, chile(0, 3), EQUIPO, 'en un rato').promesa, 'mañana lunes a partir de las 9:00',
  'respuesta por chat, domingo 3 AM · idéntico al de la llamada');

console.log('\n── 5 · La env sigue siendo el escape manual');
check(p(0, 12, { HORARIO_ESPECIALISTA: '0@10-14' }), 'en los próximos minutos',
  'con HORARIO_ESPECIALISTA puesta, gana la env aunque el equipo diga otra cosa');

console.log('\n── 6 · parseHorario');
checkOk(JSON.stringify(parseHorario('1@10-20|6@10-15')) === '{"1":[10,20],"6":[10,15]}', 'parsea bloques válidos');
checkOk(JSON.stringify(parseHorario('basura')) === '{}', 'la basura no inventa horarios');

console.log('\n── 7 · resolverDia · sin asumir UTC-4 fijo');
// 🔴 Esto usaba `Date.now() - 4*3600*1000`. Desde el primer sábado de septiembre
// Chile es UTC-3 y esa cuenta devuelve el día ANTERIOR entre 00:00 y 01:00.
check(resolverDia('hoy', '2026-09-10'), '2026-09-10', 'hoy');
check(resolverDia('mañana', '2026-09-10'), '2026-09-11', 'mañana');
check(resolverDia('lo antes posible', '2026-09-10'), '2026-09-10', 'lo antes posible = hoy');
check(resolverDia('15/09/2026', '2026-09-10'), '2026-09-15', 'fecha DD/MM/YYYY');
check(resolverDia('2026-09-15', '2026-09-10'), '2026-09-15', 'fecha ISO');
check(resolverDia('domingo', '2026-09-12'), '2026-09-14', 'domingo se corre al lunes (nadie atiende en domingo)');
checkOk(resolverDia('', '2026-09-10') === null, 'sin día → null (se llama lo antes posible)');
checkOk(resolverDia('{{cuf_dia}}', '2026-09-10') === null, 'un merge tag sin resolver no es una fecha');

console.log('');
if (fail) { console.log(`FALLARON ${fail} de ${total}`); process.exit(1); }
console.log(`TODAS OK (${total} aserciones)`);
