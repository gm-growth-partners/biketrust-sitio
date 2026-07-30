// Test del modo B (quiz) de mc-match.js con umbral — ejecuta el CÓDIGO REAL
// extraído del archivo (no una copia): scoreBici + rankDisponibles + umbralQuiz.
import { readFileSync } from 'node:fs';

const src = readFileSync(
  new URL('../functions/api/mc-match.js', import.meta.url),
  'utf-8'
);

// norm() + parseRangoAltura() + bloque scoreBici…umbralQuiz (nivel módulo).
const normSrc = src.match(/const norm = [\s\S]*?\.trim\(\);/)[0];
const presupStart = src.indexOf('function parsePresupuesto');
const rangoStart = src.indexOf('function parseRangoAltura');
const rangoEnd = src.indexOf('const cfg =');
const scoreStart = src.indexOf('function scoreBici');
const scoreEnd = src.indexOf('// ─────');
if ([presupStart, rangoStart, rangoEnd, scoreStart, scoreEnd].some(i => i < 0)) throw new Error('no encontré los bloques');

const lib = new Function(`
  ${normSrc}
  ${src.slice(presupStart, rangoEnd)}
  ${src.slice(scoreStart, scoreEnd)}
  return { scoreBici, rankDisponibles, umbralQuiz, parseDisciplina, parsePresupuesto };
`)();

// ── parsePresupuesto: lo que la gente escribe de verdad ──
const PRESUP = [
  ['3,5 millones', 3500000], ['3.5 millones', 3500000], ['3 millones', 3000000],
  ['$3.500.000', 3500000], ['3500000', 3500000], ['3,5', 3500000], ['10', 10000000],
  ['tengo 4 palos', 4000000], ['flexible', null],
];
let failP = 0;
for (const [txt, want] of PRESUP) {
  const got = lib.parsePresupuesto(txt);
  const ok = got === want;
  if (!ok) failP++;
  console.log(`${ok ? 'OK ' : 'FALLO'} presupuesto «${txt}» -> ${got} ${ok ? '' : `(esperaba ${want})`}`);
}

// Inventario sintético con la forma real de Airtable.
const bici = (id, Modelo, Disciplina, Motorizacion, Precio, Rango, Talla) => ({
  id, fields: {
    Modelo, Disciplina, 'Motorización': Motorizacion, Precio,
    'Rango altura': Rango, Talla, Estado: 'Disponible',
  },
});
const INV = [
  bici('r1', 'Levo SL S-Works', 'MTB', 'Eléctrica', 7500000, '1,68 a 1,80 m', 'M'),
  bici('r2', 'Epic 8 Pro', 'MTB', 'Muscular', 8000000, '1,75 a 1,88 m', 'L'),
  bici('r3', 'Creo SL S-Works', 'Ruta', 'Eléctrica', 4000000, '1,65 a 1,78 m', '54'),
];

// El quiz V2 pregunta 3 cosas: uso (disciplina) · presupuesto · estatura.
// La disciplina llega como TEXTO DEL BOTÓN de ManyChat → pasa por parseDisciplina.
const decide = (disponibles, crit) => {
  if (!disponibles.length) return null;
  const c = { ...crit, disciplina: crit.disciplina ? lib.parseDisciplina(crit.disciplina) : '' };
  const ranked = lib.rankDisponibles(disponibles, c);
  return ranked[0].s >= lib.umbralQuiz(c) ? ranked[0].b.fields.Modelo : null;
};

const CASES = [
  // [descripción, inventario, crit, hero esperado (null = no-match honesto)]
  ['quiz completo que calza (la estatura decide entre las dos MTB)',
    INV, { disciplina: 'MTB', presupuesto: 8000000, altura: 1.70 }, 'Levo SL S-Works'],
  ['el caso del runbook: ruta · $3M · 1,60 contra puras MTB caras',
    [INV[0], INV[1]], { disciplina: 'Ruta', presupuesto: 3000000, altura: 1.60 }, null],
  ['bici correcta muy bajo el techo del presupuesto (no castigar)',
    INV, { disciplina: 'Ruta', presupuesto: 9000000, altura: 1.70 }, 'Creo SL S-Works'],
  ['sin disciplina (no la respondió): presupuesto holgado + altura que calza',
    [INV[2]], { presupuesto: 8000000, altura: 1.70 }, 'Creo SL S-Works'],
  ['disciplina equivocada + sobre presupuesto + altura fuera',
    [INV[1]], { disciplina: 'Ruta', presupuesto: 3000000, altura: 1.60 }, null],
  ['disciplina calza pero presupuesto muy corto y altura fuera',
    [INV[1]], { disciplina: 'MTB', presupuesto: 3000000, altura: 1.60 }, null],
  ['inventario vacío',
    [], { disciplina: 'MTB', presupuesto: 8000000, altura: 1.75 }, null],
  ['botón de ManyChat «MTB / cerro» calza como MTB',
    INV, { disciplina: 'MTB / cerro', presupuesto: 8000000, altura: 1.70 }, 'Levo SL S-Works'],
  ['botón de ManyChat «Ciudad» calza como Urbana (no hay urbanas → no-match honesto)',
    INV, { disciplina: 'Ciudad', presupuesto: 8000000, altura: 1.70 }, null],
];

let fail = 0;
for (const [desc, inv, crit, want] of CASES) {
  const got = decide(inv, crit);
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'OK ' : 'FALLO'} ${desc} -> ${got || 'no-match'}${ok ? '' : ` (esperaba: ${want || 'no-match'})`}`);
}
console.log((fail + failP) === 0 ? '\nTODOS OK' : `\n${fail + failP} FALLOS`);
process.exit((fail + failP) === 0 ? 0 : 1);
