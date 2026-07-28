// Prueba la promesa de llamada de mc-llamado.js contra el horario real de Luis,
// ejecutando el CÓDIGO REAL del archivo. Verifica que el bot nunca prometa una
// llamada que el horario no permite.
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../functions/api/mc-llamado.js', import.meta.url), 'utf-8');
const grab = (re, n) => { const m = src.match(re); if (!m) throw new Error('no encontré ' + n); return m[0]; };
const bloque = [
  grab(/const HORARIO_DEFAULT = .*;/, 'HORARIO_DEFAULT'),
  grab(/const DIAS_SEMANA = \[[^\]]*\];/, 'DIAS_SEMANA'),
  grab(/function parseHorario\(env\) \{[\s\S]*?\n\}/, 'parseHorario'),
  grab(/function promesaLlamada\(env, now = new Date\(\)\) \{[\s\S]*?\n\}/, 'promesaLlamada'),
].join('\n');
const fn = new Function(`${bloque}; return promesaLlamada;`)();

// Horario de Luis: L 10-20 · MARTES LIBRE · Mi-Vi 10-20 · Sa 10-15 · DOMINGO LIBRE
// Las fechas se construyen en UTC y Chile es UTC-4 → sumamos 4 h al querer una hora local.
const chile = (dia, hora) => {
  // 2026-07-26 fue domingo. Base domingo 26-jul.
  const base = new Date(Date.UTC(2026, 6, 26, 0, 0, 0));
  base.setUTCDate(base.getUTCDate() + dia);
  base.setUTCHours(hora + 4);
  return base;
};

let fail = 0;
const check = (got, esperado, msg) => {
  const ok = got === esperado;
  console.log((ok ? 'OK   ' : 'FALLO') + ' · ' + msg + '  →  "' + got + '"' + (ok ? '' : `  (esperaba "${esperado}")`));
  if (!ok) fail++;
};
const p = (dia, hora) => fn({}, chile(dia, hora)).promesa;

// Dentro de horario
check(p(1, 11), 'en los próximos minutos', 'lunes 11:00 · abierto');
check(p(6, 12), 'en los próximos minutos', 'sábado 12:00 · abierto (cierra 15)');

// Antes de abrir, día hábil
check(p(1, 8),  'hoy a partir de las 10:00', 'lunes 08:00 · antes de abrir');

// EL MARTES LO CUBRE ROBERTO → el lead del lunes noche NO espera al miércoles.
// Este es el caso que motivó la decisión: eran 5 leads reales de la semana 30
// esperando 38 horas. Con la cobertura de Roberto, esperan ~13.
check(p(1, 21), 'mañana a partir de las 10:00', 'lunes 21:00 · Roberto cubre el martes → mañana');
check(p(2, 14), 'en los próximos minutos', 'martes 14:00 · Roberto está atendiendo');

// EL CASO DEL FIN DE SEMANA: sábado tarde salta al lunes
check(p(6, 16), 'el lunes a partir de las 10:00', 'sábado 16:00 · ya cerró (15) → lunes');
check(p(0, 12), 'mañana a partir de las 10:00', 'domingo 12:00 · día libre → mañana');

// Noche de día hábil normal
check(p(3, 22), 'mañana a partir de las 10:00', 'miércoles 22:00 · cerrado → mañana');
check(p(4, 3),  'hoy a partir de las 10:00', 'jueves 03:00 · madrugada → hoy más tarde');

// Horario configurable: si los dueños deciden otra cosa, es una env, no código
const otro = { HORARIO_ESPECIALISTA: '1@9-18|2@9-18|3@9-18|4@9-18|5@9-18' };
check(fn(otro, chile(2, 10)).promesa, 'en los próximos minutos', 'config nueva · martes 10:00 pasa a ser hábil');
check(fn(otro, chile(6, 12)).promesa, 'el lunes a partir de las 9:00', 'config nueva · sábado pasa a ser libre');

console.log(fail === 0 ? '\nTODAS OK (11 aserciones)' : `\n${fail} FALLOS`);
process.exit(fail === 0 ? 0 : 1);
