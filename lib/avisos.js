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
// LA REGLA NUEVA, UNA SOLA (decisión de Gabriel, 2026-08-06):
//   Franja 9:00–20:00 hora de Chile, TODOS los días, para TODOS los destinatarios.
//   Se acabó la lógica por persona. `AVISO_HORARIOS` queda obsoleta: bórrala.
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
