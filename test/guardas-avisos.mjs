// Guardas de regresión del sistema de avisos (2026-08-06).
//
// Este test no prueba comportamiento: prueba que NO vuelvan errores que ya
// costaron caro. Reemplaza a `test/avisos-horario.mjs`, que se borró porque su
// premisa era falsa — decía «si las copias divergen, este test lo caza» y
// comparaba justo las dos copias que eran idénticas, ignorando las otras cuatro
// (que sí habían divergido, en otro dialecto).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = join(RAIZ, 'functions', 'api');
const archivos = readdirSync(API).filter(f => f.endsWith('.js'))
  .map(f => ({ nombre: `functions/api/${f}`, src: readFileSync(join(API, f), 'utf-8') }));

let fail = 0, total = 0;
const check = (ok, msg, extra) => {
  total++;
  console.log((ok ? 'OK   ' : 'FALLO') + ' · ' + msg + (ok ? '' : '  → ' + JSON.stringify(extra)));
  if (!ok) fail++;
};

// Quita comentarios de línea para no cazar las notas que explican qué se eliminó.
const codigo = (src) => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

// ── 1 · La lógica de horario vive en UN solo lugar ───────────────────────────
// Hubo SEIS copias de `horarioOk` en dos dialectos incompatibles. Los defaults ya
// no coincidían, y con la env seteada en el formato documentado tres de ellas
// habrían avisado 24/7 en silencio.
{
  const culpables = archivos.filter(a => /function\s+horarioOk/.test(codigo(a.src))).map(a => a.nombre);
  check(culpables.length === 0, 'ningún endpoint define su propio horarioOk (usar enFranja de lib/avisos.js)', culpables);
}
{
  const culpables = archivos.filter(a => /env\.AVISO_HORARIOS/.test(codigo(a.src))).map(a => a.nombre);
  check(culpables.length === 0, 'nadie lee AVISO_HORARIOS (la env quedó obsoleta y se borra de Cloudflare)', culpables);
}
{
  // Una VENTANA (desde-hasta) escrita a mano es la misma enfermedad con otra cara.
  // Ojo: se busca el par `>= N && … < M` sobre la MISMA función de hora. Un
  // umbral suelto (`chileHour(x) >= 8`) no cuenta: ése es el de `cron-recordatorios`,
  // que decide si ya pasó la hora del recordatorio de las 8am del día de la visita.
  // Es una regla de negocio del mensaje al cliente, no la franja de avisos al equipo.
  const culpables = archivos
    .filter(a => /chileHour\([^)]*\)\s*>=\s*\d+\s*&&\s*chileHour\([^)]*\)\s*<\s*\d+/.test(codigo(a.src)))
    .map(a => a.nombre);
  check(culpables.length === 0, 'nadie hardcodea una ventana horaria propia (desde-hasta)', culpables);
}

// ── 2 · El try/catch va DENTRO del bucle de destinatarios ────────────────────
// Con el try afuera, un solo sid roto tumbaba el envío de todos los demás y —con
// el barrido reintentando— producía una tormenta de reenvíos cada 15 minutos.
{
  const culpables = archivos.filter(a => {
    const c = codigo(a.src);
    // Patrón peligroso: `try {` … `for (const sid` sin un `try` intermedio.
    const i = c.indexOf('try {');
    if (i < 0) return false;
    return /try\s*\{[^}]*for\s*\(const\s+sid/.test(c);
  }).map(a => a.nombre);
  check(culpables.length === 0, 'ningún bucle de destinatarios queda envuelto por un try externo', culpables);
}

// ── 3 · «Llamada pendiente» NO puede entrar al mapa SALIDAS ──────────────────
// Es tentador porque mc-rellamar escribe ese valor. Pero al no tener flowEnv
// entraría por `sin_mensaje_por_diseño` y RE-ESTAMPARÍA `Aviso salida enviado`,
// que es justo el sello que mc-rellamar limpia para que el rescate pueda repetirse.
{
  const salida = archivos.find(a => a.nombre.endsWith('salida-llamado.js'));
  const mapa = salida ? codigo(salida.src).split('const SALIDAS = {')[1]?.split('\n};')[0] || '' : '';
  check(!/^\s*'Llamada pendiente'\s*:/m.test(mapa), 'salida-llamado NO tiene «Llamada pendiente» en el mapa SALIDAS');
}

// ── 4 · El huso horario, en el código nuevo ──────────────────────────────────
// Chile pasa a UTC-3 el primer sábado de septiembre. `Date.now() - 4*3600*1000`
// devuelve el día anterior entre 00:00 y 01:00 desde entonces. Quedan 11 líneas
// así en el repo (deuda anotada), pero el código nuevo no puede sumar más.
{
  const nuevos = ['cron-avisos.js', 'mc-rellamar.js', 'cron-briefing.js'];
  const culpables = archivos
    .filter(a => nuevos.some(n => a.nombre.endsWith(n)))
    .filter(a => /4\s*\*\s*3600\s*\*\s*1000/.test(codigo(a.src)))
    .map(a => a.nombre);
  check(culpables.length === 0, 'el código nuevo no asume UTC-4 fijo (usa Intl vía lib/avisos.js)', culpables);
}

// ── 5 · Los endpoints nuevos consumen el módulo, no lo reimplementan ─────────
{
  const debenImportar = ['cron-avisos.js', 'mc-rellamar.js', 'cron-briefing.js', 'mc-llamado.js', 'salida-llamado.js', 'mc-waitlist.js', 'mc-consigna.js', 'cron-reenganche.js'];
  const faltan = debenImportar.filter(n => {
    const a = archivos.find(x => x.nombre.endsWith(n));
    return !a || !/from '\.\.\/\.\.\/lib\/avisos\.js'/.test(a.src);
  });
  check(faltan.length === 0, 'los 8 endpoints del sistema de avisos importan lib/avisos.js', faltan);
}

console.log('');
if (fail) { console.log(`FALLARON ${fail} de ${total}`); process.exit(1); }
console.log(`TODAS OK (${total} guardas)`);
