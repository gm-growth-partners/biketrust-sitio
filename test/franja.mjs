// Prueba lib/avisos.js — la única fuente de verdad de horario y destinatarios.
// Importa el módulo REAL (no una copia): si alguien vuelve a duplicar la lógica,
// este test sigue midiendo el original y `test/guardas-avisos.mjs` caza la copia.
import {
  enFranja, franja, chileHora, chileDia, chileFecha,
  hoyHayBriefing, esTickBriefing, sidsAviso, unaLinea,
} from '../lib/avisos.js';

let fail = 0, total = 0;
const check = (ok, msg, extra) => {
  total++;
  console.log((ok ? 'OK   ' : 'FALLO') + ' · ' + msg + (ok ? '' : '  → ' + JSON.stringify(extra)));
  if (!ok) fail++;
};

const D = (iso) => new Date(iso);

// ── 0 · El huso, primero ─────────────────────────────────────────────────────
// Chile es UTC-4 en invierno y UTC-3 en verano (cambia el primer sábado de
// septiembre). El MISMO instante UTC cae en horas distintas según el mes: por eso
// nada acá usa `Date.now() - 4*3600*1000`, que es lo que hacen 11 líneas del repo
// y lo que va a desfasar las fechas entre 00:00 y 01:00 a partir de septiembre.
console.log('\n── 0 · Huso horario (DST de Chile)');
check(chileHora(D('2026-07-15T13:00:00Z')) === 9, 'invierno (UTC-4): 13:00Z son las 09:00 en Chile');
check(chileHora(D('2026-01-15T12:00:00Z')) === 9, 'verano  (UTC-3): 12:00Z son las 09:00 en Chile');
check(chileHora(D('2026-01-15T13:00:00Z')) === 10, 'verano: 13:00Z ya son las 10:00 — el mismo instante, otra hora');
check(chileFecha(D('2026-07-15T13:00:00Z')) === '2026-07-15', 'la fecha de Chile sale bien en invierno');

// ── 1 · Los bordes de la franja ──────────────────────────────────────────────
// `hasta` es EXCLUSIVO: 19:59 es el último minuto que avisa, 20:00 ya es fuera.
console.log('\n── 1 · Bordes de la franja (invierno, UTC-4)');
check(enFranja({}, D('2026-07-15T12:59:00Z')) === false, '08:59 → FUERA');
check(enFranja({}, D('2026-07-15T13:00:00Z')) === true,  '09:00 → DENTRO');
check(enFranja({}, D('2026-07-15T17:00:00Z')) === true,  '13:00 → DENTRO');
check(enFranja({}, D('2026-07-15T23:59:00Z')) === true,  '19:59 → DENTRO (último minuto)');
check(enFranja({}, D('2026-07-16T00:00:00Z')) === false, '20:00 → FUERA (el corte declarado es el real)');
check(enFranja({}, D('2026-07-16T06:00:00Z')) === false, '02:00 de la madrugada → FUERA');

console.log('\n── 2 · Los MISMOS bordes en verano (UTC-3) — si esto falla, hay un huso hardcodeado');
check(enFranja({}, D('2026-01-15T11:59:00Z')) === false, '08:59 → FUERA');
check(enFranja({}, D('2026-01-15T12:00:00Z')) === true,  '09:00 → DENTRO');
check(enFranja({}, D('2026-01-15T22:59:00Z')) === true,  '19:59 → DENTRO');
check(enFranja({}, D('2026-01-15T23:00:00Z')) === false, '20:00 → FUERA');

// ── 3 · Todos los días, sin excepciones ──────────────────────────────────────
// Es LA simplificación pedida por Gabriel (2026-08-06): se acabó la lógica por
// persona y por día. Antes Luis no recibía martes ni domingo... en 3 de los 6
// archivos; en los otros 3 sí. Esa divergencia es la que se elimina.
console.log('\n── 3 · La franja NO distingue días ni personas');
const MARTES = D('2026-07-14T17:00:00Z');   // martes 13:00 Chile
const DOMINGO = D('2026-07-19T17:00:00Z');  // domingo 13:00 Chile
check(chileDia(MARTES) === 2, 'la fecha de prueba es efectivamente un martes');
check(chileDia(DOMINGO) === 0, 'la fecha de prueba es efectivamente un domingo');
check(enFranja({}, MARTES) === true, 'martes 13:00 → DENTRO (antes Luis quedaba fuera)');
check(enFranja({}, DOMINGO) === true, 'domingo 13:00 → DENTRO (antes Luis quedaba fuera)');

// ── 4 · La franja se puede mover sin desplegar código ────────────────────────
console.log('\n── 4 · Env AVISO_FRANJA');
check(franja({}).desde === 9 && franja({}).hasta === 20, 'default 9-20');
check(enFranja({ AVISO_FRANJA: '10-18' }, D('2026-07-15T13:00:00Z')) === false, 'con 10-18, las 09:00 quedan fuera');
check(enFranja({ AVISO_FRANJA: '10-18' }, D('2026-07-15T14:00:00Z')) === true,  'con 10-18, las 10:00 entran');
check(enFranja({ AVISO_FRANJA: 'basura' }, D('2026-07-15T13:00:00Z')) === true, 'env corrupta → cae al default, no rompe');

// ── 5 · El tick del briefing ─────────────────────────────────────────────────
// El barrido de avisos se hace a un lado en este tick para no duplicar. La guarda
// NO depende del orden del worker, a propósito: el orden es fácil de romper al
// editar el array y nadie se daría cuenta.
console.log('\n── 5 · esTickBriefing (la guarda anti-duplicado de las 09:00)');
check(esTickBriefing({}, D('2026-07-15T13:00:00Z')) === true,  '09:00 → es el tick del briefing');
check(esTickBriefing({}, D('2026-07-15T13:14:00Z')) === true,  '09:14 → sigue siendo el tick');
check(esTickBriefing({}, D('2026-07-15T13:15:00Z')) === false, '09:15 → ya no; acá el barrido recoge lo que no cupo');
check(esTickBriefing({}, D('2026-07-15T14:00:00Z')) === false, '10:00 → no');
check(hoyHayBriefing({}, DOMINGO) === true, 'por defecto el briefing sale los 7 días (ningún día ciego)');
check(hoyHayBriefing({ BRIEFING_DIAS: '13456' }, MARTES) === false, 'con BRIEFING_DIAS se puede volver a acotar');
check(esTickBriefing({ BRIEFING_DIAS: '13456' }, D('2026-07-14T13:00:00Z')) === false, 'martes sin briefing → el barrido NO se hace a un lado y drena la cola');

// ── 6 · Destinatarios ────────────────────────────────────────────────────────
console.log('\n── 6 · sidsAviso (las cadenas de fallback, en un solo lugar)');
const ENV_SIDS = {
  AVISO_LLAMADO_SIDS: '579628082, 302195575',
  LUIS_SUBSCRIBER_ID: '579628082',
};
check(sidsAviso(ENV_SIDS, 'llamado').length === 2, 'llamado: parsea la coma y limpia espacios');
check(sidsAviso(ENV_SIDS, 'briefing')[0] === '579628082', 'briefing: sin env propia cae a Luis');
check(sidsAviso(ENV_SIDS, 'equipo').length === 2, 'equipo: cae a la cadena de llamado antes que a Luis');
check(sidsAviso(ENV_SIDS, 'sourcing').length === 0, 'sourcing NO cae a Luis: sin destinatarios declarados, no se manda nada');
check(sidsAviso({}, 'llamado').length === 0, 'sin ninguna env → lista vacía, no reventar');

// ── 7 · Texto de una línea ───────────────────────────────────────────────────
// Un `\n` dentro de un parámetro hace que Meta rechace el envío, y el error que
// devuelve no menciona el salto de línea.
console.log('\n── 7 · unaLinea');
check(!unaLinea('a\nb').includes('\n'), 'colapsa el salto de línea');
check(unaLinea('a\n\n  b') === 'a · b', 'lo reemplaza por el separador de la casa');
check(unaLinea('x'.repeat(2000)).length === 900, 'recorta a 900 caracteres');
check(unaLinea(null) === '', 'null → cadena vacía, no "null"');

console.log('');
if (fail) { console.log(`FALLARON ${fail} de ${total}`); process.exit(1); }
console.log(`TODAS OK (${total} aserciones)`);
