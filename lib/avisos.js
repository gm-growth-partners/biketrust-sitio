// lib/avisos.js — LA ÚNICA fuente de verdad de "¿aviso ahora o no?" y "¿a quién?".
//
// POR QUÉ EXISTE (2026-08-06)
// Hasta hoy la decisión de horario estaba copiada SEIS veces en `functions/api/`,
// en DOS dialectos incompatibles:
//   · nuevo (dígitos):  cron-briefing · mc-llamado · salida-llamado
//   · viejo (rangos):   mc-agenda · mc-consigna · mc-waitlist
//   · y un séptimo criterio hardcodeado dentro de cron-reenganche.
// Los defaults ya no coincidían (en el dialecto viejo Luis SÍ recibía los martes),
// y peor: si `AVISO_HORARIOS` se hubiera seteado con el formato documentado —el
// nuevo—, el regex del dialecto viejo no habría calzado, habría caído en
// `if (!m) return true` y esos tres endpoints habrían avisado 24/7 EN SILENCIO.
// El test que decía cazar esa divergencia solo comparaba las dos copias idénticas.
//
// LA REGLA (decisión de Gabriel, 2026-08-06, ampliada el 2026-08-19):
//   · Sin tabla `Equipo`: franja 9:00–20:00 hora de Chile, TODOS los días, para
//     TODOS los destinatarios (`AVISO_FRANJA`). `AVISO_HORARIOS` quedó obsoleta.
//   · Con tabla `Equipo`: cada persona tiene SU horario y SUS tipos de aviso
//     (ver «EL EQUIPO Y SUS HORARIOS», más abajo). Sigue viviendo SOLO acá.
//
// Y LA REGLA QUE LA HACE SEGURA: **nunca franja sin red.**
//   Silenciar de noche sin una red que recupere lo silenciado no es "menos ruido",
//   es pérdida silenciosa. Por eso cada punto que use `enFranja()` debe además
//   dejar el sello `Aviso equipo enviado` VACÍO cuando no avisa: ese vacío es lo
//   que hace que el barrido y el briefing lo recojan después.

// ── Reloj de Chile ───────────────────────────────────────────────────────────
// SIEMPRE vía Intl. El repo tiene 11 líneas con `Date.now() - 4*3600*1000`, que
// asumen UTC-4 fijo: el primer sábado de septiembre Chile pasa a UTC-3 y esas
// líneas devuelven el día anterior entre 00:00 y 01:00. Acá no se repite el error.
const TZ = 'America/Santiago';

export const chileFecha = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

export const chileHora = (d = new Date()) =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(d));

export const chileMin = (d = new Date()) =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, minute: '2-digit' }).format(d));

// 0 = domingo … 6 = sábado
export const chileDia = (d = new Date()) =>
  ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })[
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d)
  ];

// ── La franja ────────────────────────────────────────────────────────────────
// Env `AVISO_FRANJA` = "desde-hasta" en horas de Chile. Default '9-20'.
// Se deja como env para poder moverla sin desplegar código; NO admite días ni
// personas, a propósito: esa complejidad es justo la que produjo las 6 copias.
const FRANJA_DEFAULT = '9-20';

export function franja(env = {}) {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(env.AVISO_FRANJA || FRANJA_DEFAULT).trim());
  return m ? { desde: Number(m[1]), hasta: Number(m[2]) } : { desde: 9, hasta: 20 };
}

// ¿Estamos dentro de la franja? `hasta` es EXCLUSIVO: a las 20:00 en punto ya es
// fuera (19:59 es el último minuto que avisa). El corte declarado y el real son
// el mismo número.
export function enFranja(env = {}, now = new Date()) {
  const { desde, hasta } = franja(env);
  const h = chileHora(now);
  return h >= desde && h < hasta;
}

// ── El briefing ──────────────────────────────────────────────────────────────
// Hora por `BRIEFING_HOUR` (default 9). Días: TODOS, por decisión de Gabriel
// (2026-08-06) — antes era «lun a sáb sin martes», que dejaba un día ciego a la
// semana. Se mantiene `BRIEFING_DIAS` como escape (dígitos 0=dom…6=sáb) por si
// se quiere volver a acotar sin tocar código.
export const briefingHora = (env = {}) => Number(env.BRIEFING_HOUR || 9);

export function hoyHayBriefing(env = {}, now = new Date()) {
  const dias = String(env.BRIEFING_DIAS || '0123456');
  return dias.includes(String(chileDia(now)));
}

// ¿Este tick es EL del briefing? El barrido de avisos lo usa para hacerse a un
// lado y no duplicar: a las 09:0x manda el briefing (que lista y sella todo lo
// acumulado) y el barrido no toca nada.
//
// Ojo: esta guarda NO depende del orden en que el worker llame a los endpoints.
// Es a propósito — el orden es fácil de romper sin darse cuenta al editar el
// array de `worker-cron/src/index.js`; esta línea sigue valiendo igual.
export function esTickBriefing(env = {}, now = new Date()) {
  return hoyHayBriefing(env, now) && chileHora(now) === briefingHora(env) && chileMin(now) < 15;
}

// ── Destinatarios ────────────────────────────────────────────────────────────
// Hoy hay cuatro cadenas de fallback distintas repartidas por los endpoints, y
// todas terminan en `LUIS_SUBSCRIBER_ID`. Eso tiene un efecto que no es obvio:
// agregar a alguien a UNA env lo puede suscribir de rebote a avisos de otra cosa
// si la suya no está seteada. Acá quedan declaradas en un solo lugar y a la vista.
const CADENAS = {
  llamado:   ['AVISO_LLAMADO_SIDS', 'LUIS_SUBSCRIBER_ID'],
  briefing:  ['BRIEFING_SIDS', 'LUIS_SUBSCRIBER_ID'],
  equipo:    ['AVISO_EQUIPO_SIDS', 'AVISO_LLAMADO_SIDS', 'LUIS_SUBSCRIBER_ID'],
  solicitud: ['AVISO_SOLICITUD_SIDS', 'LUIS_SUBSCRIBER_ID'],
  consigna:  ['AVISO_CONSIGNA_SIDS', 'LUIS_SUBSCRIBER_ID'],
  reagendo:  ['AVISO_REAGENDO_SIDS', 'LUIS_SUBSCRIBER_ID'],
  // Sourcing NO cae a Luis: si nadie declaró a los que salen a buscar, no se
  // manda nada. Mejor silencio que avisarle a la persona equivocada.
  sourcing:  ['AVISO_SOURCING_SIDS'],
};

export function sidsAviso(env = {}, cual) {
  for (const k of CADENAS[cual] || []) {
    const v = String(env[k] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (v.length) return v;
  }
  return [];
}

// ═════════════════════════════════════════════════════════════════════════════
// LAS COLAS, DEFINIDAS UNA SOLA VEZ (2026-08-20)
//
// «¿Esto todavía espera acción?» se responde con el campo que toca LA PERSONA en
// su Kanban, nunca con un derivado que mantiene el código. Esa confusión costó
// trece mañanas de briefing repitiendo a un lead ya cerrado (ver CHANGELOG
// 2026-08-19), y la única forma de que no vuelva es que la pregunta se escriba
// en un solo lugar y todos la importen desde acá.
//
// Las leen: `cron-briefing` (qué listar), `cron-avisos` (qué barrer) y
// `aviso-llamada` (contra qué deduplicar).
// ═════════════════════════════════════════════════════════════════════════════

// Tabla `Llamados`. `Salida` es lo que arrastra Luis. «No contestado» SIGUE en la
// cola a propósito: no contestar no cierra nada, es la bandeja de reintentos.
// `BLANK()` cubre el ticket recién creado que aún no tiene columna.
export const COLA_LLAMADOS =
  `OR({Salida}='Llamada pendiente', {Salida}='No contestado', {Salida}=BLANK())`;

// Tabla `Avisos`. Misma idea: la columna del Kanban «6 · Falta responder» manda.
// `Resuelto` se conserva como escape manual — sólo puede SACAR cosas de la cola,
// nunca meterlas, así que no puede producir fantasmas.
export const COLA_AVISOS =
  `AND({Resuelto}=0, OR({Salida}=BLANK(), {Salida}='Pendiente'))`;

// ── Texto ────────────────────────────────────────────────────────────────────
// Un `\n` DENTRO de un parámetro de plantilla hace que Meta rechace el envío, y
// el error que devuelve no dice eso. Todo lo que va a una variable pasa por acá.
export const unaLinea = (txt, max = 900) =>
  String(txt ?? '').replace(/\s*\n+\s*/g, ' · ').replace(/\s{2,}/g, ' ').trim().slice(0, max);

// ── El envío ─────────────────────────────────────────────────────────────────
const MC_API = 'https://api.manychat.com';
const mcSid = (s) => (/^\d+$/.test(s) ? Number(s) : s);

async function afetch(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, opts);
    if (r.status !== 429 || i >= tries - 1) return r;
    await new Promise(res => setTimeout(res, 1200 * (i + 1)));
  }
}

async function mcPost(token, path, body) {
  return afetch(`${MC_API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
}

// Manda `texto` (en el custom field `campo`) + dispara `flowEnv` a cada sid.
//
// ⚠️ EL TRY/CATCH VA **DENTRO** DEL BUCLE, y esto es lo más importante de este
// archivo. Hoy `mc-llamado` y `cron-sourcing` lo tienen AFUERA: si el segundo
// destinatario falla, el primero —que ya recibió— se cuenta como fallido y todo
// el bloque cae al catch. Sin reintentos eso era inofensivo. Con el barrido nuevo
// es una bomba: un solo sid roto (típicamente uno recién agregado a mano, o un
// contacto sin canal de WhatsApp) impide que se escriba el sello, y el barrido
// reenvía a TODOS los demás cada 15 minutos, para siempre.
//
// Devuelve { enviados, errores }. La regla del sello es `enviados > 0`: si al
// menos una persona se enteró, el caso está cubierto y no se reintenta.
// `extra` permite una SEGUNDA variable en la misma plantilla. Lo usa el briefing,
// que tiene {{1}} = cf_llamados_hoy y {{2}} = cf_agenda_hoy: dos variables en vez
// de una porque una variable de plantilla no admite saltos de línea, y con una
// sola el briefing entero quedaba en un párrafo apelmazado.
export async function avisarStaff(env = {}, { cual, flowEnv, campo, texto, extra, sids } = {}) {
  const token = env.MANYCHAT_TOKEN || env.MC_TOKEN || '';
  const flowNs = env[flowEnv] || '';
  const destinos = sids && sids.length ? sids : sidsAviso(env, cual);

  if (!token || !flowNs || !destinos.length) {
    return {
      enviados: 0,
      errores: [],
      motivo: 'no_configurado',
      falta: [!token && 'MANYCHAT_TOKEN', !flowNs && flowEnv, !destinos.length && `sids:${cual}`].filter(Boolean),
    };
  }

  const campos = [{ campo, texto }, ...(extra ? [extra] : [])]
    .filter(c => c && c.campo)
    .map(c => ({ campo: c.campo, valor: unaLinea(c.texto) }));

  let enviados = 0;
  const errores = [];

  for (const sid of destinos) {
    try {
      for (const c of campos) {
        const r1 = await mcPost(token, '/fb/subscriber/setCustomFieldByName', {
          subscriber_id: mcSid(sid), field_name: c.campo, field_value: c.valor,
        });
        if (!r1.ok) throw new Error(`setField ${c.campo} ${r1.status}: ${(await r1.text()).slice(0, 120)}`);
      }
      const r2 = await mcPost(token, '/fb/sending/sendFlow', { subscriber_id: mcSid(sid), flow_ns: flowNs });
      if (!r2.ok) throw new Error(`sendFlow ${r2.status}: ${(await r2.text()).slice(0, 120)}`);
      enviados++;
    } catch (e) {
      errores.push(`${sid}: ${String((e && e.message) || e).slice(0, 140)}`);
    }
  }

  return { enviados, errores, motivo: enviados ? 'enviado' : 'error' };
}

// ═════════════════════════════════════════════════════════════════════════════
// EL EQUIPO Y SUS HORARIOS (2026-08-19, pedido de Gabriel)
//
// «Que el aviso le llegue a ciertas personas, cada una en SU horario; y si entra
// fuera del horario de todos, que vaya al briefing de la mañana con el detalle y
// la acción pendiente.»
//
// El 2026-08-06 se había decidido UNA franja para todos (9–20) porque la lógica
// por persona vivía copiada seis veces en dos dialectos. Volver a «por persona»
// es seguro SOLO porque ahora vive en un único lugar: este archivo. Ningún
// endpoint decide horarios ni destinatarios por su cuenta.
//
// DE DÓNDE SALE EL EQUIPO — tabla Airtable `Equipo` (editable sin desplegar):
//   Nombre · SID ManyChat · Horario · Recibe (multi-select) · Activo · Notas
//   · `Horario`: bloques `días@desde-hasta` separados por `|`, en hora de Chile.
//     Días 0=domingo … 6=sábado, con rangos: `1-6@9-20|0@10-14`. `*` = todos.
//     VACÍO = la franja general (AVISO_FRANJA, default 9-20, todos los días) —
//     así olvidar el horario de alguien NO lo deja sin avisos.
//   · `Recibe`: Llamadas · Humano · Solicitudes · Consignaciones · Sourcing ·
//     Reagendo · Briefing. Cada tipo de aviso del sistema cae en uno de éstos.
//   · `Activo` apagado = la fila no existe para el sistema.
//
// RED DE SEGURIDAD: si la tabla no existe, está vacía, o nadie está suscrito al
// tipo, se usan las envs de siempre (`AVISO_*_SIDS` + franja global). Desplegar
// este código ANTES de crear la tabla no cambia nada.
//
// LA REGLA DEL SELLO NO CAMBIA: si al menos una persona en horario recibió, el
// caso está cubierto (sello). Si nadie estaba en horario, no se manda, el sello
// queda vacío, y el barrido o el briefing lo recogen. Nunca franja sin red.
// ═════════════════════════════════════════════════════════════════════════════

// tipo de aviso → cadena de envs de fallback (`sidsAviso`) + valor de `Recibe`.
export const TIPOS = {
  llamada:   { cual: 'llamado',   recibe: 'Llamadas' },
  humano:    { cual: 'equipo',    recibe: 'Humano' },
  solicitud: { cual: 'solicitud', recibe: 'Solicitudes' },
  consigna:  { cual: 'consigna',  recibe: 'Consignaciones' },
  sourcing:  { cual: 'sourcing',  recibe: 'Sourcing' },
  reagendo:  { cual: 'reagendo',  recibe: 'Reagendo' },
  briefing:  { cual: 'briefing',  recibe: 'Briefing' },
};

// En el modo de fallback (sin tabla `Equipo`) estos tipos NO llevan franja, igual
// que hasta hoy: el briefing tiene su propia hora, el reagendo es de una visita de
// HOY, y sourcing es un cron que nunca tuvo guarda. `humano` SÍ entra a la franja
// desde ahora (antes sonaba 24/7): es lo que pidió Gabriel, y la red lo cubre.
const SIN_FRANJA_EN_FALLBACK = new Set(['briefing', 'reagendo', 'sourcing']);

// ── Los dos tipos que no se filtran por hora ─────────────────────────────────
//
// `reagendo` no mira NADA: avisa que una visita de HOY se movió, y es el único
// aviso del sistema que no deja sello en ninguna parte. Sin red, silenciarlo es
// perderlo. Si algún día se le pone sello, sale de esta lista.
const SIN_FILTRO = new Set(['reagendo']);

// `briefing` mira el DÍA pero no la HORA (corregido 2026-08-20). La distinción
// importa y la destapó el equipo real:
//   · Si mirara la hora, alguien cuyo turno empieza a las 10:00 nunca recibiría
//     el briefing de las 9:00. Por eso al principio no miraba nada.
//   · Pero al no mirar nada, Juan Alfonso —que cubre sólo los martes— recibía
//     SEIS briefings inútiles por semana, y Luis dos (martes y domingo, que no
//     trabaja). Un resumen diario para quien trabaja un día a la semana no es
//     información: es ruido, y el ruido es cómo muere un tablero.
// La pregunta correcta no es «¿estás en turno a las 9:00?» sino «¿trabajas hoy?».
const POR_DIA = new Set(['briefing']);

// ¿Trabaja hoy esta persona? Sin mirar la hora.
// Sin horario propio cae a la franja general, que no distingue días → siempre sí.
export function trabajaHoy(horarioTxt, now = new Date()) {
  const H = parseHorarioPersona(horarioTxt);
  if (!H) return true;
  return Boolean(H[chileDia(now)]);
}

// `1-6@9-20|0@10-14` · `*@9-20` · `1@10-20|2@10-20` → { 0:[10,14], 1:[9,20], … }
// Vacío o inválido → null (= usar la franja general).
export function parseHorarioPersona(txt) {
  const s = String(txt ?? '').trim();
  if (!s) return null;
  const out = {};
  let alguno = false;
  for (const bloque of s.split('|')) {
    const m = /^\s*(\*|[0-6](?:\s*-\s*[0-6])?(?:\s*,\s*[0-6](?:\s*-\s*[0-6])?)*)\s*@\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(bloque);
    if (!m) continue;
    const desde = Number(m[2]), hasta = Number(m[3]);
    if (!(desde >= 0 && desde <= 24 && hasta >= 0 && hasta <= 24 && desde < hasta)) continue;
    const dias = [];
    if (m[1] === '*') dias.push(0, 1, 2, 3, 4, 5, 6);
    else for (const parte of m[1].split(',')) {
      const r = /^\s*([0-6])(?:\s*-\s*([0-6]))?\s*$/.exec(parte);
      if (!r) continue;
      const a = Number(r[1]), b = r[2] != null ? Number(r[2]) : a;
      for (let d = a; d <= b; d++) dias.push(d);
    }
    for (const d of dias) { out[d] = [desde, hasta]; alguno = true; }
  }
  return alguno ? out : null;
}

// ¿Esta persona está en horario ahora? `hasta` exclusivo, igual que la franja.
export function enHorarioPersona(horarioTxt, now = new Date(), env = {}) {
  const H = parseHorarioPersona(horarioTxt);
  if (!H) return enFranja(env, now);
  const h = H[chileDia(now)];
  if (!h) return false;
  const hora = chileHora(now);
  return hora >= h[0] && hora < h[1];
}

// Unión de horarios de un grupo de personas, en el formato `dia@desde-hasta|…`
// que entiende `HORARIO_ESPECIALISTA` (mc-llamado): sirve para que la promesa
// de llamada al cliente refleje a QUIÉN le va a llegar el aviso, no una env aparte.
// Por día se toma el bloque más amplio (min desde · max hasta). Sin gente → ''.
export function horarioUnion(personas = [], env = {}) {
  const porDia = {};
  for (const p of personas) {
    const H = parseHorarioPersona(p.horario) || (() => { const f = franja(env); const o = {}; for (let d = 0; d < 7; d++) o[d] = [f.desde, f.hasta]; return o; })();
    for (const [d, [a, b]] of Object.entries(H)) {
      const prev = porDia[d];
      porDia[d] = prev ? [Math.min(prev[0], a), Math.max(prev[1], b)] : [a, b];
    }
  }
  return Object.keys(porDia).map(Number).sort().map(d => `${d}@${porDia[d][0]}-${porDia[d][1]}`).join('|');
}

// ── Lectura de la tabla `Equipo` (con caché corta) ───────────────────────────
const BASE_DEFAULT = 'appQUgk8aeD752923';
const EQUIPO_TTL_MS = 60 * 1000;
let _equipoCache = { base: '', hasta: 0, filas: null };

const normRecibe = (v) => (Array.isArray(v) ? v : (v ? [v] : []))
  .map(x => String(typeof x === 'string' ? x : x?.name ?? '').trim().toLowerCase()).filter(Boolean);

export function _resetEquipoCache() { _equipoCache = { base: '', hasta: 0, filas: null }; }

// → [{ nombre, sid, horario, recibe:Set<string minúsculas>, activo }] · null si no hay tabla.
export async function cargarEquipo(env = {}, { force = false } = {}) {
  const BASE = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  if (!READ) return null;
  const ahora = Date.now();
  if (!force && _equipoCache.base === BASE && _equipoCache.hasta > ahora) return _equipoCache.filas;
  const tabla = env.AIRTABLE_EQUIPO_TABLE || 'Equipo';
  let filas = null;
  try {
    const r = await afetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(tabla)}?pageSize=100`,
      { headers: { Authorization: `Bearer ${READ}` } });
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j?.records)) {
        filas = j.records.map(rec => {
          const f = rec.fields || {};
          return {
            id: rec.id,
            nombre: String(f['Nombre'] || '').trim(),
            sid: String(f['SID ManyChat'] || f['SID'] || '').trim(),
            horario: String(f['Horario'] || '').trim(),
            recibe: new Set(normRecibe(f['Recibe'])),
            activo: f['Activo'] === true,
            // Quién le contesta al cliente. Distinto de quién recibe el aviso.
            atiende: f['Atiende clientes'] === true,
          };
        });
      }
    }
  } catch { filas = null; }
  _equipoCache = { base: BASE, hasta: ahora + EQUIPO_TTL_MS, filas };
  return filas;
}

// ── ¿A quién le toca AHORA este tipo de aviso? ───────────────────────────────
// → { sids, fuente:'equipo'|'env', personas:[nombres en horario],
//     fuera:[nombres suscritos pero fuera de horario], sinSid:[…] }
// `sids` vacío + `fuera` no vacío = «hay gente, pero nadie en horario» → el caso
// queda para el barrido/briefing. `sids` vacío + `fuera` vacío = nadie configurado.
export async function destinatarios(env = {}, tipo, now = new Date(), { ignorarHorario = false } = {}) {
  const T = TIPOS[tipo];
  if (!T) return { sids: [], fuente: 'env', personas: [], fuera: [], sinSid: [], motivo: `tipo_desconocido:${tipo}` };

  const sinFiltro = ignorarHorario || SIN_FILTRO.has(tipo);
  const porDia = POR_DIA.has(tipo);
  const equipo = await cargarEquipo(env);
  const suscritos = (equipo || []).filter(p => p.activo && p.recibe.has(T.recibe.toLowerCase()));
  if (suscritos.length) {
    const conSid = suscritos.filter(p => p.sid);
    const dentro = sinFiltro ? conSid
      : porDia ? conSid.filter(p => trabajaHoy(p.horario, now))
        : conSid.filter(p => enHorarioPersona(p.horario, now, env));
    return {
      sids: dentro.map(p => p.sid),
      fuente: 'equipo',
      personas: dentro.map(p => p.nombre),
      fuera: conSid.filter(p => !dentro.includes(p)).map(p => p.nombre),
      sinSid: suscritos.filter(p => !p.sid).map(p => p.nombre),
    };
  }

  // Fallback: la regla de hoy — cadena de envs + franja global.
  const sids = sidsAviso(env, T.cual);
  const abierto = sinFiltro || porDia || SIN_FRANJA_EN_FALLBACK.has(tipo) || enFranja(env, now);
  return { sids: abierto ? sids : [], fuente: 'env', personas: [], fuera: abierto ? [] : sids, sinSid: [] };
}

// Azúcar: ¿hay alguien en horario para este tipo?
export async function hayAlguien(env = {}, tipo, now = new Date()) {
  return (await destinatarios(env, tipo, now)).sids.length > 0;
}

// Las filas del equipo suscritas a un tipo (activas y con sid), SIN filtrar por
// horario.
export async function suscritosA(env = {}, tipo) {
  const T = TIPOS[tipo];
  if (!T) return [];
  const equipo = await cargarEquipo(env);
  return (equipo || []).filter(p => p.activo && p.sid && p.recibe.has(T.recibe.toLowerCase()));
}

// ═════════════════════════════════════════════════════════════════════════════
// QUIÉN ATIENDE AL CLIENTE ≠ QUIÉN RECIBE EL AVISO (2026-08-20)
//
// Parecen lo mismo y no lo son. Gabriel y Roberto reciben avisos TODOS los días
// de 8 a 20 —para mirar el negocio—, pero el que le contesta a la persona es
// Luis (y Juan Alfonso los martes). Si la promesa que el bot le hace al cliente
// saliera de «quién recibe el aviso», un domingo a las 10:00 el bot prometería
// respuesta ese mismo día porque Roberto está de turno. Y sería mentira.
//
// Por eso la tabla `Equipo` tiene el checkbox **`Atiende clientes`**: sólo esas
// filas cuentan para la promesa.
//
// ⚠️ Y a propósito NO se exige `SID ManyChat`: alguien puede atender los martes
// aunque todavía no esté registrado en ManyChat para recibir el WhatsApp. El
// horario que se le promete al cliente depende de quién TRABAJA, no de quién
// está cableado.
// ═════════════════════════════════════════════════════════════════════════════
export async function atiendenClientes(env = {}) {
  const equipo = await cargarEquipo(env);
  return (equipo || []).filter(p => p.activo && p.atiende);
}

// ── La promesa que se le hace al cliente ─────────────────────────────────────
// El bot NO puede prometer «te respondemos al tiro» a las 2 AM ni un domingo:
// una promesa incumplida hace más daño que no haberla hecho.
//
// Orden de precedencia del horario:
//   1. env `HORARIO_ESPECIALISTA` — si está seteada, manda (escape manual).
//   2. La unión de los turnos de quien tiene `Atiende clientes` en la tabla.
//   3. El default de abajo.
//
// Formato: bloques `dia@desde-hasta` separados por `|`. Día 0=domingo … 6=sábado.
export const HORARIO_DEFAULT = '1@9-20|2@9-20|3@9-20|4@9-20|5@9-20|6@9-15';
export const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function parseHorario(txt) {
  const out = {};
  for (const bloque of String(txt || '').split('|')) {
    const m = /^(\d)@(\d{1,2})-(\d{1,2})$/.exec(bloque.trim());
    if (m) out[Number(m[1])] = [Number(m[2]), Number(m[3])];
  }
  return out;
}

// → { abierto, promesa, dia }
// `cuandoAbierto` es el texto para «hay alguien AHORA»: una llamada sale «en los
// próximos minutos», una respuesta por chat sale «en un rato». Es lo único que
// cambia entre los dos usos, así que la lógica de horario vive una sola vez.
//
// Cuando no hay nadie hoy, la promesa NOMBRA EL DÍA («mañana lunes a partir de
// las 9:00») en vez de decir sólo «mañana». Pedido de Gabriel: si alguien
// escribe un domingo a las 3 AM, tiene que quedarle claro que es el lunes.
export function promesaAtencion(env = {}, now = new Date(), horarioTxt = '', cuandoAbierto = 'en un rato') {
  const H = parseHorario(String(env.HORARIO_ESPECIALISTA || horarioTxt || HORARIO_DEFAULT));
  const hora = chileHora(now);
  const hoy = chileDia(now);

  const hoyH = H[hoy];
  if (hoyH && hora >= hoyH[0] && hora < hoyH[1]) return { abierto: true, promesa: cuandoAbierto, dia: null };
  if (hoyH && hora < hoyH[0]) return { abierto: false, promesa: `hoy a partir de las ${hoyH[0]}:00`, dia: DIAS_SEMANA[hoy] };
  for (let i = 1; i <= 7; i++) {
    const d = (hoy + i) % 7;
    if (H[d]) {
      const cuando = i === 1 ? `mañana ${DIAS_SEMANA[d]}` : `el ${DIAS_SEMANA[d]}`;
      return { abierto: false, promesa: `${cuando} a partir de las ${H[d][0]}:00`, dia: DIAS_SEMANA[d] };
    }
  }
  return { abierto: false, promesa: 'apenas abramos', dia: null };
}

// ── EL ENVÍO ÚNICO: decide destinatarios por horario y manda ─────────────────
// Devuelve lo mismo que `avisarStaff` + `destinatarios`. Reglas de lectura:
//   enviados > 0                → alguien se enteró → SELLAR.
//   enviados = 0, motivo 'fuera_de_horario' → nadie en horario → NO sellar; lo
//                                 recoge el barrido cuando alguien entre, o el briefing.
//   enviados = 0, otro motivo   → fallo o sin configurar → NO sellar; reintenta el barrido.
export async function avisar(env = {}, { tipo, flowEnv, campo, texto, extra, now = new Date(), ignorarHorario = false } = {}) {
  const T = TIPOS[tipo];
  if (!T) return { enviados: 0, errores: [], motivo: `tipo_desconocido:${tipo}`, destinatarios: null };
  const d = await destinatarios(env, tipo, now, { ignorarHorario });
  if (!d.sids.length) {
    const motivo = d.fuera.length ? 'fuera_de_horario' : 'no_configurado';
    return { enviados: 0, errores: [], motivo, destinatarios: d,
      ...(motivo === 'no_configurado' ? { falta: [`sids:${tipo}`] } : {}) };
  }
  const r = await avisarStaff(env, { cual: T.cual, flowEnv, campo, texto, extra, sids: d.sids });
  return { ...r, destinatarios: d };
}

// ═════════════════════════════════════════════════════════════════════════════
// CONTEXTO DEL LEAD para el aviso (2026-08-19)
// «Sería ideal agregar contexto para que quien llame sepa qué bici vio o cuáles
// han sido sus consultas.» Se arma desde el CRM, no desde ManyChat: lo que el bot
// mandó (fichas, match, tickets previos, avisos previos) ya está en Airtable.
// Best-effort y acotado: ≤ 3 intereses, lecturas mínimas. Si algo falla, vacío.
// ═════════════════════════════════════════════════════════════════════════════
const linkIds = (v) => (Array.isArray(v) ? v : (v ? [v] : [])).map(x => (typeof x === 'string' ? x : x?.id)).filter(Boolean);
const ddmm = (iso) => {
  if (!iso) return '';
  try { return new Intl.DateTimeFormat('es-CL', { timeZone: TZ, day: '2-digit', month: '2-digit' }).format(new Date(iso)); }
  catch { return ''; }
};

// → { linea: 'vio: Levo SL (ficha 10/08), Kenevo (match) · ticket pendiente desde 05/08 · 2º aviso', partes: {...} }
export async function contextoLead(env = {}, { leadId, leadFields } = {}) {
  const vacio = { linea: '', partes: {} };
  const BASE = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  if (!READ || !leadId) return vacio;
  const api = (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`;
  const rH = { Authorization: `Bearer ${READ}` };
  const partes = {};
  try {
    let lf = leadFields;
    if (!lf) {
      const r = await afetch(`${api(env.AIRTABLE_LEADS_TABLE || 'Leads')}/${leadId}`, { headers: rH });
      lf = r.ok ? ((await r.json()).fields || {}) : {};
    }
    // 1) Las bicis que vio (últimos 3 intereses, del más nuevo al más viejo).
    const interIds = linkIds(lf['Intereses']).slice(-3).reverse();
    const vistas = [];
    for (const id of interIds) {
      const ir = await afetch(`${api(env.AIRTABLE_INTERESES_TABLE || 'Intereses')}/${id}`, { headers: rH });
      if (!ir.ok) continue;
      const inf = (await ir.json()).fields || {};
      const biciId = linkIds(inf['Bici'])[0];
      let nombre = '';
      if (biciId) {
        const br = await afetch(`${api('Inventario')}/${biciId}`, { headers: rH });
        if (br.ok) { const bf = (await br.json()).fields || {}; nombre = bf.Modelo || bf.Etiqueta || ''; }
      }
      const res = String(inf['Resultado'] || '').toLowerCase();
      const como = res.includes('ficha') ? 'ficha' : res.includes('no-match') || res.includes('no match') ? 'sin match'
        : res.includes('match') ? 'match' : res.includes('agend') ? 'agendó' : res.includes('cerr') ? 'compró' : '';
      const cuando = ddmm(inf['Fecha'] || inf['Creado']);
      if (nombre || como) vistas.push(`${nombre || 'bici'}${como || cuando ? ` (${[como, cuando].filter(Boolean).join(' ')})` : ''}`);
    }
    if (vistas.length) partes.vio = `vio: ${vistas.join(', ')}`;
    else if (lf['MC bici']) partes.vio = `vio: ${String(lf['MC bici']).slice(0, 80)}`;

    // 2) Tickets de llamada previos (links inversos en el Lead).
    const nLlam = linkIds(lf['Llamados']).length;
    if (nLlam) partes.llamados = `${nLlam} ticket${nLlam > 1 ? 's' : ''} de llamada`;

    // 3) Avisos previos («2º aviso» = el humano ya se lo pidieron antes).
    const nAv = linkIds(lf['Avisos']).length;
    if (nAv) partes.avisos = `${nAv + 1}º aviso`;

    // 4) Estado del lead, legible.
    if (lf['Estado']) partes.estado = `estado ${String(lf['Estado']).replace(/_/g, ' ')}`;
  } catch { /* best-effort */ }
  const linea = [partes.vio, partes.llamados, partes.avisos, partes.estado].filter(Boolean).join(' · ');
  return { linea, partes };
}
