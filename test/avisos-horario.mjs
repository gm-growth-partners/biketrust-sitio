// Verifica QUIÉN recibe aviso y CUÁNDO, ejecutando el código real de los dos
// archivos que tienen el helper duplicado. Si divergen, este test lo caza.
//
// Cobertura acordada (2026-07-27):
//   Luis    → lunes, miércoles, jueves, viernes, sábado · 9:00 a 20:00
//   Roberto → TODOS los días · 9:00 a 20:00 (además cubre el martes)
import { readFileSync } from 'node:fs';

const LUIS = '579628082', ROBERTO = '302195575';

function cargar(archivo) {
  const src = readFileSync(new URL(`../functions/api/${archivo}`, import.meta.url), 'utf-8');
  const def = src.match(/const HORARIOS_DEFAULT = .*;/);
  // Ojo: la firma contiene `new Date()`, así que el corte va en el primer `) {`.
  const fn = src.match(/function horarioOk\([\s\S]*?\) \{[\s\S]*?\n\}/);
  if (!def || !fn) throw new Error('no encontré horarioOk en ' + archivo);
  return new Function(`${def[0]}\n${fn[0]}\nreturn horarioOk;`)();
}

// 2026-07-26 fue domingo. Chile = UTC-4.
const chile = (dia, hora) => {
  const d = new Date(Date.UTC(2026, 6, 26, 0, 0, 0));
  d.setUTCDate(d.getUTCDate() + dia);
  d.setUTCHours(hora + 4);
  return d;
};
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

let fail = 0;
const check = (got, esperado, msg) => {
  const ok = got === esperado;
  console.log((ok ? 'OK   ' : 'FALLO') + ' · ' + msg + (ok ? '' : `  → dio ${got}, esperaba ${esperado}`));
  if (!ok) fail++;
};

for (const archivo of ['mc-llamado.js', 'cron-briefing.js']) {
  const ok = cargar(archivo);
  console.log(`\n── ${archivo}`);
  const L = (d, h) => ok({}, LUIS, chile(d, h));
  const R = (d, h) => ok({}, ROBERTO, chile(d, h));

  // Luis: los días que trabaja
  for (const d of [1, 3, 4, 5, 6]) check(L(d, 11), true, `Luis recibe el ${DIAS[d]} 11:00`);
  // Luis: los días que NO
  check(L(2, 11), false, 'Luis NO recibe el martes (lo cubre Roberto)');
  check(L(0, 11), false, 'Luis NO recibe el domingo');
  // Roberto: todos los días, incluido el martes y el domingo
  check(R(2, 11), true, 'Roberto SÍ recibe el martes');
  check(R(0, 11), true, 'Roberto SÍ recibe el domingo');
  for (const d of [1, 3, 5]) check(R(d, 11), true, `Roberto recibe el ${DIAS[d]} 11:00`);

  // La ventana horaria: nada antes de las 9 ni después de las 20
  check(L(1, 8), false, 'nadie recibe a las 8:00 (antes lo cubre el briefing)');
  check(L(1, 20), false, 'nadie recibe a las 20:00 (corte)');
  check(L(1, 19), true, 'sí recibe a las 19:00');
  check(R(1, 3), false, 'nada de madrugada');

  // Config: si mañana Roberto también toma los domingos, es cambiar la env
  const otra = { AVISO_HORARIOS: `${LUIS}:13456@9-20,${ROBERTO}:0123456@8-21` };
  check(ok(otra, ROBERTO, chile(0, 20)), true, 'config nueva: Roberto hasta las 21');
}

console.log(fail === 0 ? `\nTODAS OK (${28} aserciones, los dos archivos coinciden)` : `\n${fail} FALLOS`);
process.exit(fail === 0 ? 0 : 1);
