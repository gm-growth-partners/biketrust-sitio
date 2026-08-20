// Cloudflare Pages Function · POST /api/aviso-humano
//
// ═══════════════════════════════════════════════════════════════════════════
// LA ENTRADA COMÚN DE «ESTO NECESITA A UNA PERSONA» (2026-08-19)
// ═══════════════════════════════════════════════════════════════════════════
//
// Pedido de Gabriel, textual: «todas las solicitudes que el bot no reconoce, ya
// sea por wsp, instagram o cualquier canal futuro, tengan una entrada común y
// estructura de funcionamiento común, ya que hoy día creo que no lo tiene.
// Necesito que al llegar una solicitud, se envíe un wsp con la información de
// mensaje y el canal bajo un horario determinado que es distinto para cada
// persona.»
//
// ANTES: esto era `mc-aviso`, y tenía tres huecos que lo dejaban a medio camino
// de «entrada común»:
//   1. IDENTIDAD SÓLO DE INSTAGRAM. Resolvía el Lead únicamente por `@handle IG`.
//      En WhatsApp ese campo no existe (el único identificador estable es el
//      `subscriber_id` de ManyChat), así que TODO aviso de WhatsApp nacía
//      huérfano: sin Lead enlazado, fuera del rollup «Terminó en venta» y sin
//      contexto para quien tuviera que responder.
//   2. NO REGISTRABA EL CANAL. El equipo recibía «un cliente necesita a una
//      persona» sin saber si responder por Instagram o por WhatsApp.
//   3. NO TENÍA RED. Sin horario (a propósito, para no perder al lead de las
//      23:00) pero también sin sello ni barrido: si el envío fallaba, o si nadie
//      miraba el teléfono a esa hora, el aviso se perdía y a la mañana siguiente
//      NADIE se enteraba — la tabla `Avisos` no la lee ningún briefing.
//
// AHORA: identidad multicanal, el canal viaja y queda escrito, y el aviso es un
// ESTADO con sello (`Aviso equipo enviado`) — igual que los tickets de llamada.
// Vacío = nadie del equipo se enteró todavía. Ese vacío es lo que hace que
// `cron-avisos` lo mande apenas alguien entre a su turno y que el briefing de la
// mañana lo liste con su acción pendiente. Nunca franja sin red.
//
// ⚠️ CAMBIO DE COMPORTAMIENTO DELIBERADO. Hasta hoy este aviso NO respetaba
// horario, con este razonamiento (2026-08-03): «un lead varado a las 23:00 es
// mejor que suene a que se pierda». Ese razonamiento era correcto cuando no
// había red; ahora la hay. Gabriel pidió horario por persona para todos los
// avisos, así que se aplica. Para volver al comportamiento viejo basta setear
// la env `AVISO_HUMANO_24H=1` — no hay que tocar código.
//
// ── Contrato ────────────────────────────────────────────────────────────────
// Body (todo opcional, pero manda al menos un identificador):
//   handle · subscriber_id · telefono   identidad, en ese orden de preferencia
//   canal      'DM IG' · 'Comentario IG' · 'WhatsApp' · 'Web' …
//   motivo     'el bot no entendió el mensaje' · 'pregunta técnica, pidió por chat' …
//   mensaje    lo que escribió la persona, textual
//
// Además exporta `avisarHumano(env, {...})`, que es el MISMO camino para los
// avisos de «necesita persona» que nacen dentro del backend (mc-rellamar cuando
// alguien aprieta un botón sobre un ticket que ya avanzó, cron-avisos cuando se
// rinde tras 3 intentos). Así todos quedan registrados en la tabla `Avisos` y
// todos entran al briefing: una sola estructura de funcionamiento, como se pidió.
//
// Protegido por MC_KEY (?key=).

import {
  avisar, contextoLead, unaLinea, atiendenClientes, horarioUnion, promesaAtencion,
} from '../../lib/avisos.js';

const JSONH = { 'Content-Type': 'application/json; charset=utf-8' };
const BASE_DEFAULT = 'appQUgk8aeD752923';
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSONH });

async function afetch(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, opts);
    if (r.status !== 429 || i >= tries - 1) return r;
    await new Promise(res => setTimeout(res, 1200 * (i + 1)));
  }
}

const keyOk = (env, url) => { const need = env.MC_KEY; return need ? url.searchParams.get('key') === need : true; };
const esc = (s) => String(s).replace(/'/g, "\\'");

// Texto limpio: recorta y descarta merge tags sin resolver ({{cuf_…}}).
const clean = (v, max = 400) => {
  const s = String(v ?? '').trim();
  if (!s || s.includes('{{')) return '';
  return s.slice(0, max);
};

const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const CANALES = {
  'dm ig': 'DM IG', 'dm': 'DM IG', 'instagram': 'DM IG', 'ig': 'DM IG',
  'comentario ig': 'Comentario IG', 'comentario': 'Comentario IG',
  'whatsapp': 'WhatsApp', 'wsp': 'WhatsApp', 'wa': 'WhatsApp',
  'web': 'Web', 'sitio': 'Web', 'quiz': 'Quiz', 'messenger': 'Messenger',
};
const canonCanal = (v) => CANALES[sinAcentos(v)] || '';

// Dónde va a responder el humano, según el canal. Es la «acción pendiente» que
// el briefing tiene que poder imprimir sin volver a razonarla.
export const dondeResponder = (canal) =>
  canal === 'WhatsApp' ? 'respóndele por WhatsApp'
    : canal === 'Web' ? 'escríbele tú (entró por el sitio)'
      : canal ? 'respóndele en la bandeja de ManyChat'
        : 'respóndele en la bandeja de ManyChat';

// ── Resolver el Lead, multicanal ────────────────────────────────────────────
// Orden: @handle IG (el dedup histórico de Instagram) → MC subscriber id (el
// único estable en WhatsApp) → WhatsApp/teléfono (la web). NO crea el Lead: en
// la cascada de ManyChat `mc-lead` ya corrió antes, y crear uno acá sin canal
// confiable lo mandaría a la puerta «Sin canal registrado» del tablero, tapando
// el bug de flujo real.
async function buscarLead(C, { handle, subId, telefono }) {
  for (const formula of [
    handle ? `LOWER({@handle IG})='${esc(handle.toLowerCase())}'` : null,
    subId ? `{MC subscriber id}='${esc(subId)}'` : null,
    telefono ? `{WhatsApp}='${esc(telefono)}'` : null,
  ].filter(Boolean)) {
    try {
      const rr = await afetch(`${C.api(C.LEADS)}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`, { headers: C.rH });
      if (!rr.ok) continue;
      const rec = ((await rr.json()).records || [])[0];
      if (rec) return { id: rec.id, fields: rec.fields || {} };
    } catch { /* sin link, pero el aviso igual se registra */ }
  }
  return null;
}

const cfg = (env) => {
  const BASE = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  const WRITE = env.AIRTABLE_WRITE_TOKEN;
  return {
    BASE, READ, WRITE,
    LEADS: env.AIRTABLE_LEADS_TABLE || 'Leads',
    AVISOS: env.AIRTABLE_AVISOS_TABLE || 'Avisos',
    api: (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`,
    rH: { Authorization: `Bearer ${READ}` },
    wH: { Authorization: `Bearer ${WRITE}`, 'Content-Type': 'application/json' },
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// EL NÚCLEO. Lo usan la ruta HTTP y los avisos que nacen dentro del backend.
// → { registro, avisoId, aviso, enviados, destinatarios, resumen, leadId }
// ═══════════════════════════════════════════════════════════════════════════
export async function avisarHumano(env = {}, {
  handle = '', subId = '', telefono = '', canal = '', motivo = '', mensaje = '',
  conContexto = true, now = new Date(),
} = {}) {
  const C = cfg(env);
  const nowIso = now.toISOString();

  const lead = C.READ ? await buscarLead(C, { handle, subId, telefono }) : null;

  // Contexto de la conversación: qué bicis vio, cuántas veces volvió, qué
  // preguntó. Es lo que convierte «alguien necesita ayuda» en algo accionable.
  let ctx = { linea: '', partes: {} };
  if (conContexto && lead) ctx = await contextoLead(env, { leadId: lead.id, leadFields: lead.fields });

  const quien = lead?.fields?.Nombre || (handle ? `IG @${handle}` : (telefono || (subId ? `contacto ${subId}` : 'contacto sin identificar')));

  // Segmentos de más a menos accionable: `unaLinea` corta por el final.
  const resumen = unaLinea([
    quien,
    canal ? `por ${canal}` : '',
    motivo || 'necesita a una persona',
    mensaje ? `dijo: «${mensaje}»` : '',
    ctx.linea,
    dondeResponder(canal),
  ].filter(Boolean).join(' · '));

  // ── El envío ──────────────────────────────────────────────────────────────
  // `AVISO_HUMANO_24H=1` restaura el comportamiento anterior a 2026-08-19: sonar
  // siempre, sin mirar el horario de nadie.
  const res = await avisar(env, {
    tipo: 'humano', flowEnv: 'FLOW_NS_AVISO_EQUIPO', campo: 'cf_aviso_datos', texto: resumen, now,
    ignorarHorario: String(env.AVISO_HUMANO_24H || '') === '1',
  });
  const enviados = res.enviados || 0;

  // ── El registro ───────────────────────────────────────────────────────────
  // Ocurre SIEMPRE, aunque el WhatsApp no haya salido y aunque falten las envs:
  // la métrica de «cuántas veces el bot necesitó a un humano» no puede depender
  // de que el mensaje se haya entregado. Y el sello vacío es lo que hace que el
  // barrido y el briefing lo recojan después.
  let registro = 'sin_token', avisoId = null;
  if (C.WRITE) {
    try {
      const cr = await afetch(C.api(C.AVISOS), {
        method: 'POST', headers: C.wH,
        body: JSON.stringify({ typecast: true, fields: {
          'Resumen': resumen.slice(0, 250),
          ...(handle ? { '@handle IG': handle } : {}),
          ...(subId ? { 'Subscriber ID': subId } : {}),
          ...(canal ? { 'Canal': canal } : {}),
          ...(motivo ? { 'Motivo': motivo } : {}),
          ...(mensaje ? { 'Mensaje': mensaje } : {}),
          'WhatsApp enviado': enviados > 0,
          // El sello: con fecha si alguien se enteró, VACÍO si no. Vacío = cola.
          ...(enviados > 0 ? { 'Aviso equipo enviado': nowIso } : {}),
          // Nace en la primera columna del Kanban «6 · Falta responder». Que la
          // tarjeta nazca ya en su columna evita que aparezca unos segundos en la
          // pila «sin categoría» — misma decisión que en `Llamados`.
          'Salida': 'Pendiente',
          'Resuelto': false,
          ...(lead ? { 'Lead': [lead.id] } : {}),
        } }),
      });
      if (cr.ok) { avisoId = (await cr.json()).id; registro = 'registrado'; }
      else registro = 'error';
    } catch { registro = 'error'; }
  }

  // ── LA PROMESA AL CLIENTE ──────────────────────────────────────────────────
  // Pedido de Gabriel (2026-08-20): «si alguien escribe un domingo a las 3 AM,
  // se le dice: ok, perfecto, nuestro especialista te responderá mañana (lunes)
  // apenas llegue».
  //
  // Hasta ahora el bot NO prometía plazo a propósito, porque no sabía calcularlo
  // y «en minutos» a las 2 AM es una promesa rota. Ahora sí lo sabe, así que
  // puede prometer — y la promesa sale del horario de quien **atiende clientes**,
  // no de quien recibe el aviso.
  //
  // ManyChat la imprime mapeando `$.promesa` a un campo del contacto:
  //   «Le paso tu mensaje a un especialista y te responde {{cf_promesa}}.»
  const atienden = await atiendenClientes(env);
  const pr = promesaAtencion(env, now, horarioUnion(atienden, env), 'en un rato');

  return {
    registro, avisoId, leadId: lead?.id || null,
    aviso: enviados > 0 ? 'enviado' : (res.motivo === 'fuera_de_horario' ? 'pendiente_de_briefing' : `sin_enviar:${res.motivo}`),
    enviados, destinatarios: res.destinatarios || null,
    resumen, contexto: ctx.linea || null,
    promesa: pr.promesa, dentroDeHorario: pr.abierto,
    ...(res.falta ? { falta: res.falta } : {}),
  };
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return reply({ error: 'unauthorized' }, 401);

  let data;
  try { data = await request.json(); } catch { return reply({ error: 'bad_json' }, 400); }

  const out = await avisarHumano(env, {
    handle: clean(data?.handle, 60).replace(/^@/, ''),
    subId: clean(data?.subscriber_id, 40),
    telefono: clean(data?.telefono, 60),
    canal: canonCanal(clean(data?.canal, 40)),
    motivo: clean(data?.motivo, 120),
    mensaje: clean(data?.mensaje, 500),
  });
  return reply({ ok: true, ...out });
}

// GET — describe el contrato (para montar el flujo en ManyChat sin adivinar).
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return reply({ error: 'unauthorized' }, 401);
  return reply({
    ok: true,
    que: 'Entrada común de «el bot no pudo, esto necesita a una persona». Registra en la tabla Avisos y avisa al equipo en su horario.',
    identificadores: ['handle', 'subscriber_id', 'telefono'],
    body: { handle: 'sin arroba', subscriber_id: 'id de ManyChat', telefono: '', canal: Object.values(CANALES).filter((v, i, a) => a.indexOf(v) === i), motivo: '', mensaje: '' },
    alias: '/api/mc-aviso apunta a este mismo endpoint',
    devuelve: {
      promesa: 'texto listo para imprimirle al cliente («mañana lunes a partir de las 9:00»). Mapear $.promesa a un campo de ManyChat.',
      dentroDeHorario: 'true si hay alguien atendiendo AHORA',
    },
    atiendenClientes: (await atiendenClientes(env)).map(p => ({ nombre: p.nombre, horario: p.horario || '(franja general)' })),
    promesaAhora: promesaAtencion(env, new Date(), horarioUnion(await atiendenClientes(env), env), 'en un rato').promesa,
    horario24h: String(env.AVISO_HUMANO_24H || '') === '1',
  });
}
