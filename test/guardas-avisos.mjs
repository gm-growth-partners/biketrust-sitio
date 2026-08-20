// Guardas de regresión del sistema de avisos.
//
// Este test no prueba comportamiento: prueba que NO vuelvan errores que ya
// costaron caro. Reemplazó a `test/avisos-horario.mjs`, que se borró porque su
// premisa era falsa — decía «si las copias divergen, este test lo caza» y
// comparaba justo las dos copias que eran idénticas, ignorando las otras cuatro
// (que sí habían divergido, en otro dialecto).
//
// Ampliado el 2026-08-19 con las cuatro guardas de la auditoría de avisos.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = join(RAIZ, 'functions', 'api');
const archivos = readdirSync(API).filter(f => f.endsWith('.js'))
  .map(f => ({ nombre: `functions/api/${f}`, base: f, src: readFileSync(join(API, f), 'utf-8') }));
const uno = (n) => archivos.find(a => a.base === n);

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
  check(culpables.length === 0, 'ningún endpoint define su propio horarioOk (usar lib/avisos.js)', culpables);
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
//
// ⚠️ El regex viejo era `try\s*\{[^}]*for\s*\(const\s+sid`, y NO servía: se cortaba
// en la primera llave, así que cualquier template literal (`${x}`) entre el `try`
// y el `for` lo cegaba. Por eso no vio que `mc-agenda` tenía exactamente ese bug,
// vivo, durante dos semanas. Ahora mira una ventana de 1200 caracteres.
{
  const culpables = archivos
    .filter(a => /try\s*\{[\s\S]{0,1200}?for\s*\(const\s+sid/.test(codigo(a.src)))
    .map(a => a.nombre);
  check(culpables.length === 0, 'ningún bucle de destinatarios queda envuelto por un try externo', culpables);
}

// ── 3 · «Llamada pendiente» NO puede entrar al mapa SALIDAS ──────────────────
// Es tentador porque mc-rellamar escribe ese valor. Pero al no tener flowEnv
// entraría por `sin_mensaje_por_diseño` y RE-ESTAMPARÍA `Aviso salida enviado`,
// que es justo el sello que mc-rellamar limpia para que el rescate pueda repetirse.
{
  const salida = uno('salida-llamado.js');
  const mapa = salida ? codigo(salida.src).split('const SALIDAS = {')[1]?.split('\n};')[0] || '' : '';
  check(!/^\s*'Llamada pendiente'\s*:/m.test(mapa), 'salida-llamado NO tiene «Llamada pendiente» en el mapa SALIDAS');
}

// ── 4 · El huso horario, en el código nuevo ──────────────────────────────────
// Chile pasa a UTC-3 el primer sábado de septiembre. `Date.now() - 4*3600*1000`
// devuelve el día anterior entre 00:00 y 01:00 desde entonces. Queda deuda de
// esas líneas en el repo, pero el código nuevo no puede sumar más.
{
  const nuevos = ['cron-avisos.js', 'mc-rellamar.js', 'cron-briefing.js', 'aviso-llamada.js', 'aviso-humano.js'];
  const culpables = archivos
    .filter(a => nuevos.includes(a.base))
    .filter(a => /4\s*\*\s*3600\s*\*\s*1000/.test(codigo(a.src)))
    .map(a => a.nombre);
  check(culpables.length === 0, 'el código nuevo no asume UTC-4 fijo (usa Intl vía lib/avisos.js)', culpables);
}

// ── 5 · Los endpoints consumen el módulo, no lo reimplementan ────────────────
{
  const debenImportar = [
    'cron-avisos.js', 'mc-rellamar.js', 'cron-briefing.js', 'aviso-llamada.js',
    'salida-llamado.js', 'mc-waitlist.js', 'mc-consigna.js', 'cron-reenganche.js',
    'aviso-humano.js', 'mc-agenda.js', 'cron-sourcing.js',
  ];
  const faltan = debenImportar.filter(n => {
    const a = uno(n);
    return !a || !/from '\.\.\/\.\.\/lib\/avisos\.js'/.test(a.src);
  });
  check(faltan.length === 0, 'los 11 endpoints del sistema de avisos importan lib/avisos.js', faltan);
}

// ── 6 · NADIE resuelve destinatarios por su cuenta (2026-08-19) ──────────────
// Cada endpoint tenía su propia cadena de fallback terminando en
// `LUIS_SUBSCRIBER_ID`. El efecto no era obvio: sumar a alguien a UNA env lo
// suscribía de rebote a los avisos de otra cosa. Ahora las cadenas están
// declaradas en un solo lugar (`CADENAS` en lib/avisos.js) y a la vista.
{
  const culpables = archivos
    .filter(a => /env\.(AVISO_[A-Z]+_SIDS|LUIS_SUBSCRIBER_ID|BRIEFING_SIDS)/.test(codigo(a.src)))
    .map(a => a.nombre);
  check(culpables.length === 0, 'ningún endpoint lee *_SIDS directo (los da sidsAviso/destinatarios)', culpables);
}

// ── 7 · La cola de llamadas se define por `Salida`, no por `Estado` ──────────
// 🔴 EL BUG DE LOS 13 DÍAS. `Salida` es el campo que toca Luis (arrastra la
// tarjeta); `Estado` es un espejo que mantiene el código. Se desincronizaron y el
// briefing le repitió a Luis, todas las mañanas, gente que él ya había marcado
// «Sin interés». Quien define la cola es el campo del OPERADOR.
{
  // La definición vive en UN solo lugar: `lib/avisos.js`. Que esté centralizada
  // es la mitad del arreglo — la otra mitad es que nadie escriba la suya.
  const lib = readFileSync(join(RAIZ, 'lib', 'avisos.js'), 'utf-8');
  check(/export const COLA_LLAMADOS\s*=[\s\S]{0,200}\{Salida\}='No contestado'/.test(lib),
    'lib/avisos.js define COLA_LLAMADOS por {Salida}');
  check(/export const COLA_AVISOS\s*=[\s\S]{0,200}\{Salida\}/.test(lib),
    'lib/avisos.js define COLA_AVISOS por {Salida}');
  const bloqueLlam = (lib.match(/export const COLA_LLAMADOS\s*=([\s\S]{0,200}?);/) || [])[1] || '';
  check(!/\{Estado\}/.test(bloqueLlam), 'COLA_LLAMADOS NO menciona el espejo {Estado}', bloqueLlam.slice(0, 120));

  const deben = ['cron-briefing.js', 'cron-avisos.js', 'aviso-llamada.js'];
  const faltan = deben.filter(n => {
    const a = uno(n);
    return !a || !/COLA_LLAMADOS/.test(codigo(a.src));
  });
  check(faltan.length === 0, 'briefing, barrido y dedup importan COLA_LLAMADOS en vez de escribirla', faltan);
}
{
  // Y ninguno puede volver a escribir la fórmula a mano. (`Solicitudes` sí usa
  // {Estado}='Llamada pendiente' legítimamente: esa tabla no tiene `Salida`.)
  const culpables = archivos
    .filter(a => /\{Salida\}='Llamada pendiente'/.test(codigo(a.src)))
    .map(a => a.nombre);
  check(culpables.length === 0, 'ningún endpoint escribe la fórmula de la cola a mano', culpables);
}

// ── 8 · `salida-llamado` sincroniza el Estado ANTES de los returns tempranos ──
// La otra mitad del bug de los 13 días: el espejo se escribía al FINAL, y dos
// caminos se iban antes (`sin_lead` para tickets sin Lead enlazado, `ya_enviado`
// para los que ya mandaron un mensaje al cliente). Un ticket marcado «Sin interés»
// por cualquiera de esos dos caminos nunca cerraba.
{
  const a = uno('salida-llamado.js');
  const src = a ? codigo(a.src) : '';
  const iEspejo = src.indexOf('ESTADO_POR_SALIDA[salida]');
  const iSinLead = src.indexOf("'sin_lead'");
  const iYaEnviado = src.indexOf("accion: 'ya_enviado'");
  check(iEspejo > 0 && iSinLead > 0 && iYaEnviado > 0 && iEspejo < iSinLead && iEspejo < iYaEnviado,
    'salida-llamado escribe el espejo de Estado antes de sin_lead y de ya_enviado',
    { iEspejo, iSinLead, iYaEnviado });
}

// ── 9 · TDZ: `nombre` se declara antes de usarse (2026-08-19) ────────────────
// En `mc-llamado` la constante `nombre` se declaraba DESPUÉS del bloque de dedup,
// pero el texto del aviso «🔁 VOLVIÓ» la usaba dentro de ese bloque: zona muerta
// temporal → ReferenceError → 500. Reventaba justo en la rama más valiosa (el
// lead que ya dejó su número y vuelve a preguntar por otra bici).
{
  const a = uno('aviso-llamada.js');
  const src = a ? codigo(a.src) : '';
  const decl = src.indexOf('const nombre =');
  const usos = [...src.matchAll(/(?<![A-Za-z0-9_$])nombre(?![A-Za-z0-9_$])/g)];
  const primera = usos.length ? usos[0].index : -1;
  check(decl > 0 && primera === decl + 'const '.length,
    'aviso-llamada declara `nombre` antes de cualquier uso (regresión TDZ)', { decl, primera });
}

// ── 10 · Nadie compara un record id contra ARRAYJOIN de un enlace ────────────
// 🔴 En una fórmula de Airtable, un campo de enlace se evalúa a su valor VISIBLE
// (el campo primario del registro enlazado), NO al record id. `FIND('recXXX',
// ARRAYJOIN({Lead}))` da 0 SIEMPRE. Verificado contra la base real.
// Costó el botón «Sí, llámenme» entero: todo el que lo apretaba caía en
// «sin_ticket» y se derivaba a un humano, con su ticket ahí al lado.
// La forma correcta es el enlace inverso (`Leads.Llamados`) + `RECORD_ID()`.
//
// ⚠️ Lo que SÍ vale es `ARRAYJOIN` sobre un campo LOOKUP del RecID —lo que hace
// `mc-waitlist` con `{Lead RecID}`—, porque ahí lo que se junta ya son ids.
// Comprobado contra la base real: `FIND('recA24…', ARRAYJOIN({Lead RecID}))`
// devuelve 2 filas y `FIND('recA24…', ARRAYJOIN({Lead}))` devuelve 0.
// Por eso el patrón exige el nombre EXACTO del campo de enlace.
{
  const culpables = archivos
    .filter(a => /ARRAYJOIN\(\{(Lead|Llamados|Bici|Intereses|Solicitud)\}\)/.test(codigo(a.src)))
    .map(a => a.nombre);
  check(culpables.length === 0, 'nadie busca por ARRAYJOIN de un campo de enlace (usar RECORD_ID)', culpables);
}

console.log('');
if (fail) { console.log(`FALLARON ${fail} de ${total}`); process.exit(1); }
console.log(`TODAS OK (${total} guardas)`);
