// Test del matching modo A de mc-match.js — ejecuta el CÓDIGO REAL extraído
// del archivo (no una copia), contra los 12 modelos Disponibles reales.
import { readFileSync } from 'node:fs';

const src = readFileSync(
  new URL('../functions/api/mc-match.js', import.meta.url),
  'utf-8'
);

// norm() (nivel módulo) + bloque modo A (desde `const lev =` hasta antes de `const dispMatch`)
const normSrc = src.match(/const norm = [\s\S]*?\.trim\(\);/)[0];
const blockStart = src.indexOf('    const lev =');
const blockEnd = src.indexOf('    const dispMatch');
if (blockStart < 0 || blockEnd < 0) throw new Error('no encontré el bloque modo A');
const block = src.slice(blockStart, blockEnd);

// El bloque usa `modelo` (la query); lo envolvemos en una función.
const makeMatcher = new Function('modelo', `
  ${normSrc}
  ${block}
  return matches;
`);

// Los 12 Disponibles reales (Marca + Modelo, de Airtable 2026-07-27).
const DISPONIBLES = [
  'Levo SL2 S-Works', 'Epic S-Works EVO', 'Kenevo Expert', 'Epic 8 Pro',
  'Levo SL S-Works', 'Creo SL S-Works', 'Diverge E5 Elite', 'Levo Comp Alloy',
  'Crux Expert', 'Levo 4G S-Works', 'Kenevo Comp', 'Levo Expert T-Type',
].map((m, i) => ({ id: 'rec' + i, fields: { Marca: 'Specialized', Modelo: m, Estado: 'Disponible' } }));

const run = (q) => makeMatcher(q)(DISPONIBLES).map(x => x.b.fields.Modelo);

const CASES = [
  // [query, principal esperada, ¿debe haber match?]
  ['Levo sl swork',  'Levo SL S-Works', true],   // ← el caso real que falló (Interés #235)
  ['levo sl sworks', 'Levo SL S-Works', true],
  ['sl sworks',      null,              true],   // ambiguo: varias SL S-Works, debe desambiguar
  ['sworks',         null,              true],
  ['levo sl2',       'Levo SL2 S-Works', true],
  ['quenevo',        'Kenevo Expert',   true],   // typo histórico documentado
  ['cruz',           'Crux Expert',     true],   // typo histórico documentado
  ['epic 8',         'Epic 8 Pro',      true],
  ['creo',           'Creo SL S-Works', true],
  ['diverge',        'Diverge E5 Elite', true],
  ['trek madone',    null,              false],  // no debe inventar match
  ['tarmac',         null,              false],  // existe pero no Disponible → waitlist
  ['stumpjumper',    null,              false],  // vendida → waitlist
];

let fail = 0;
for (const [q, top, wantHit] of CASES) {
  const res = run(q);
  const okHit = wantHit ? res.length >= 1 : res.length === 0;
  const okTop = top ? res[0] === top : true;
  const ok = okHit && okTop;
  if (!ok) fail++;
  console.log(`${ok ? 'OK ' : 'FALLO'} "${q}" -> [${res.join(' | ') || 'sin match'}]${top ? ` (esperaba principal: ${top})` : ''}`);
}
console.log(fail === 0 ? '\nTODOS OK' : `\n${fail} FALLOS`);
process.exit(fail === 0 ? 0 : 1);
