// Cloudflare Pages Function · POST /api/aviso-llamada
//
// ═══════════════════════════════════════════════════════════════════════════
// LA ENTRADA COMÚN DE «ALGUIEN DEJÓ SU TELÉFONO» (2026-08-19)
// ═══════════════════════════════════════════════════════════════════════════
//
// Pedido de Gabriel, textual: «los avisos de aviso llamada, que se gatilla
// cuando una persona deja su teléfono en cualquier flujo, también debería tener
// una entrada común que recopile sus datos. No es necesario saber de dónde
// vino, sino que simplemente que se mande el aviso vía wsp a los miembros del
// equipo con el número a llamar, sería ideal agregar contexto a ese mensaje
// para que quien llame supiera más de la conversación que el bot tuvo con la
// persona, qué bicicleta vio o cuáles han sido sus consultas.»
//
// ANTES: esto vivía en `mc-llamado`, bautizado «Puerta 2 (región)» porque nació
// para leads de fuera de Santiago. Con el V2 dejó de ser eso —todo lead que
// entrega su teléfono cae acá, venga de comentario, DM, WhatsApp o la web— pero
// el nombre y el contrato seguían contando la historia vieja. Este archivo ES
// aquel endpoint, renombrado a lo que de verdad hace y con cuatro cosas nuevas:
//
//   1. IDENTIDAD MULTICANAL de verdad. Antes exigía `handle` (Instagram) o
//      `subscriber_id`. Ahora acepta además `telefono` como identificador de
//      último recurso, que es lo único que trae un formulario de la web.
//   2. EL CANAL viaja y queda escrito (`Canal` del ticket + el texto del aviso),
//      para que quien llame sepa por dónde le respondió el bot.
//   3. CONTEXTO DE LA CONVERSACIÓN en el aviso: qué bicis vio, con qué resultado,
//      cuántas veces ha vuelto y qué preguntó la última vez. Sale del CRM
//      (`contextoLead` en lib/avisos.js), no de ManyChat: lo que el bot hizo ya
//      está escrito en Airtable.
//   4. HORARIO POR PERSONA. El aviso sale sólo a quien esté en su turno. Si no
//      hay nadie, NO se manda y el sello `Aviso equipo enviado` queda VACÍO:
//      ese vacío es lo que hace que el briefing de la mañana lo liste con su
//      acción pendiente. Nunca franja sin red.
//
// `/api/mc-llamado` sigue existiendo y apunta acá (mismo código, otra URL), así
// que los flujos de ManyChat ya montados NO hay que tocarlos.
//
// ── Contrato ────────────────────────────────────────────────────────────────
// Body (todo opcional salvo un identificador):
//   handle          @ de Instagram, sin arroba
//   subscriber_id   id de ManyChat — el ÚNICO identificador estable en WhatsApp
//   telefono        el número a llamar (y, si no hay nada más, el identificador)
//   canal           'DM IG' · 'Comentario IG' · 'WhatsApp' · 'Web' · 'Quiz' …
//   mensaje         lo último que escribió (va al contexto del aviso)
//   ciudad · franja ('Mañana'/'Tarde') · dia (quick reply o fecha) · notas
//   bici            recId de Inventario   (Puerta 2, cf_hero_bici)
//   reel            Post ID de Instagram  (Puerta 1 → Reels.Bici)
//   ref             Referencia de la bici (Puerta 3, los botones del sitio)
//   optin           true si además declaró el permiso explícito
//
// Respuesta: { ok, llamadoId, leadId, dedup, biciNombre, aviso, promesaLlamada,
//              dentroDeHorario, contexto, destinatarios }
//
// `promesaLlamada` va lista para que ManyChat la imprima:
//   «Luis te llama {{promesaLlamada}} desde el +56 9 XXXX XXXX.»
// Nunca promete lo que el horario no permite.
//
// Lee con AIRTABLE_TOKEN, escribe con AIRTABLE_WRITE_TOKEN. Protegido por MC_KEY.

import {
  avisar, contextoLead, atiendenClientes, horarioUnion, unaLinea,
  chileFecha, promesaAtencion, parseHorario, HORARIO_DEFAULT, COLA_LLAMADOS, quedaPendiente,
} from '../../lib/avisos.js';

// Re-exportado para el test, que prueba el parseo del horario contra el archivo real.
export { parseHorario };

const JSONH = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSONH });

const BASE_DEFAULT = 'appQUgk8aeD752923';

// Si al equipo ya se le avisó de este lead hace menos de esto, la rama de dedup
// no vuelve a sonar. La guarda es POR TIEMPO, no por «ya existe un ticket»: así
// una ráfaga de tres reels seguidos produce un aviso, no tres — pero un lead que
// vuelve a los tres días sí despierta a alguien.
const REARME_MIN = 120;

async function afetch(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, opts);
    if (r.status !== 429 || i >= tries - 1) return r;
    await new Promise(res => setTimeout(res, 1200 * (i + 1)));
  }
}

const keyOk = (env, url) => { const need = env.MC_KEY; return need ? url.searchParams.get('key') === need : true; };

// ── La promesa de llamada ───────────────────────────────────────────────────
// La lógica vive en `lib/avisos.js` (`promesaAtencion`), compartida con la
// promesa de RESPUESTA por chat de `aviso-humano`: lo único que cambia entre las
// dos es el texto de «hay alguien ahora». Tener dos copias del cálculo de
// horario es exactamente la enfermedad que se curó el 2026-08-06.
//
// ⚠️ El horario sale de quien tiene **`Atiende clientes`** en la tabla `Equipo`,
// NO de quien recibe los avisos. Gabriel y Roberto reciben todos los días de 8 a
// 20 para mirar el negocio, pero el que llama es Luis (y Juan Alfonso los
// martes): si la promesa saliera de los destinatarios, un domingo a las 10:00 el
// bot prometería una llamada ese mismo día.
export function promesaLlamada(env, now = new Date(), horarioTxt = '') {
  return promesaAtencion(env, now, horarioTxt, 'en los próximos minutos');
}

// Texto limpio: recorta y descarta merge tags sin resolver ({{cuf_…}}).
const clean = (v, max = 200) => {
  const s = v == null ? '' : String(v).trim();
  return s.includes('{{') ? '' : s.slice(0, max);
};

const p2 = (n) => String(n).padStart(2, '0');
const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const esc = (s) => String(s).replace(/'/g, "\\'");
const linkIds = (v) => (Array.isArray(v) ? v : (v ? [v] : [])).map(x => (typeof x === 'string' ? x : x?.id)).filter(Boolean);

// Aritmética de fechas en hora de Chile, sin asumir UTC-4.
// 🔴 El repo tiene 11 líneas con `Date.now() - 4*3600*1000`, que devuelven el día
// ANTERIOR entre 00:00 y 01:00 desde el primer sábado de septiembre (Chile pasa a
// UTC-3). Acá no se repite: la fecha de hoy sale de `chileFecha` vía Intl, y el
// resto es aritmética sobre el string, que no tiene huso.
const masDias = (fecha, n) => new Date(Date.parse(fecha + 'T00:00:00Z') + n * 86400 * 1000).toISOString().slice(0, 10);

// Día preferido para el llamado (`dia`): quick reply del bot ('lo antes posible',
// 'hoy', 'mañana', 'lunes'…'sábado') o fecha explícita ('YYYY-MM-DD','DD/MM/YYYY').
// El staff no llama en domingo → un domingo se corre al lunes.
export function resolverDia(v, hoyCL) {
  const s = sinAcentos(clean(v, 40));
  if (!s) return null;
  let out = null, m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) out = `${m[1]}-${p2(m[2])}-${p2(m[3])}`;
  else if ((m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/.exec(s))) out = `${m[3]}-${p2(m[2])}-${p2(m[1])}`;
  else if (/antes posible|cuanto antes|asap/.test(s) || /^hoy/.test(s)) out = hoyCL;
  else if (/^manana/.test(s)) out = masDias(hoyCL, 1);
  else {
    const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const idx = DIAS.findIndex(d => s.startsWith(d));
    if (idx >= 0) {
      const hoyDow = new Date(hoyCL + 'T12:00:00Z').getUTCDay();
      out = masDias(hoyCL, (idx - hoyDow + 7) % 7);   // 0 = hoy mismo
    }
  }
  if (!out) return null;
  if (new Date(out + 'T12:00:00Z').getUTCDay() === 0) out = masDias(out, 1);   // domingo → lunes
  return out;
}

// "2026-07-21" → "lunes 21 de julio" (para el resumen del aviso al staff).
function diaLegible(f) {
  const d = new Date(f + 'T12:00:00Z');
  if (isNaN(d)) return f;
  return new Intl.DateTimeFormat('es-CL', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(d);
}

const cfg = (env) => {
  const BASE = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  const WRITE = env.AIRTABLE_WRITE_TOKEN;
  return {
    BASE, READ, WRITE,
    LEADS: env.AIRTABLE_LEADS_TABLE || 'Leads',
    LLAM: env.AIRTABLE_LLAMADOS_TABLE || 'Llamados',
    REELS: env.AIRTABLE_REELS_TABLE || 'Reels',
    api: (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`,
    rH: { Authorization: `Bearer ${READ}` },
    wH: { Authorization: `Bearer ${WRITE}`, 'Content-Type': 'application/json' },
  };
};

// Canal declarado por el flujo → valor canónico de `Leads.Canal origen`.
// ⚠️ `typecast:true` CREA opciones de select al escribir: un canal libre metería
// basura en el campo (ya hay dos opciones en blanco de deuda por esto mismo).
// Por eso acá hay una lista blanca y todo lo demás cae en 'DM IG'.
const CANALES = {
  'dm ig': 'DM IG', 'dm': 'DM IG', 'instagram': 'DM IG', 'ig': 'DM IG',
  'comentario ig': 'Comentario IG', 'comentario': 'Comentario IG',
  'whatsapp': 'WhatsApp', 'wsp': 'WhatsApp', 'wa': 'WhatsApp',
  'web': 'Web', 'sitio': 'Web',
  'quiz': 'Quiz', 'messenger': 'Messenger', 'tienda': 'Tienda',
};
const canonCanal = (v) => CANALES[sinAcentos(v)] || '';

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return reply({ error: 'unauthorized' }, 401);

  let data;
  try { data = await request.json(); }
  catch { return reply({ error: 'bad_json' }, 400); }

  const handle = data?.handle ? String(data.handle).trim().replace(/^@/, '') : '';
  const subId = data?.subscriber_id ? String(data.subscriber_id).trim() : '';
  const telefono = clean(data?.telefono, 60);
  const optin = data?.optin === true || data?.optin === 1 || data?.optin === '1' || String(data?.optin).toLowerCase() === 'true';
  const ciudad = clean(data?.ciudad, 80);
  // Franja: los botones de ManyChat traen la hora ("Mañana 11:00") — se normaliza
  // al valor canónico del select (Mañana/Tarde) para no crear opciones basura.
  const franjaRaw = clean(data?.franja, 40);
  const franjaPref = /^ma[ñn]ana/i.test(franjaRaw) ? 'Mañana'
    : /^tarde/i.test(franjaRaw) ? 'Tarde' : franjaRaw;
  const biciIn = clean(data?.bici, 40);
  const reel = clean(data?.reel, 80);
  const ref = clean(data?.ref, 40);
  const notas = clean(data?.notas, 2000);
  const mensaje = clean(data?.mensaje, 400);
  const canalTxt = clean(data?.canal, 40);
  const canal = canonCanal(canalTxt);

  // 🔴 IDENTIDAD MULTICANAL. Antes esto exigía handle o subscriber_id y devolvía
  // 422 si no venían: un formulario de la web, que sólo tiene teléfono, no podía
  // entrar por acá. El teléfono es identificador de último recurso, no el
  // preferido (una persona puede cambiar de número), pero es mejor que perder
  // el lead.
  if (!handle && !subId && !telefono) {
    return reply({ error: 'missing_fields (handle, subscriber_id o telefono)' }, 422);
  }

  const C = cfg(env);
  if (!C.READ || !C.WRITE) return reply({ error: 'not_configured' }, 503);
  const ahora = new Date();
  const now = ahora.toISOString();
  const today = chileFecha(ahora);
  const llamarEl = resolverDia(data?.dia || data?.fechaLlamado, today);

  // ── 1 · Resolver el Lead ───────────────────────────────────────────────────
  // Orden: @handle IG (el dedup histórico) → subscriber_id (el único estable en
  // WhatsApp) → teléfono (la web). Se crea si no existe.
  const findLead = async (formula) => {
    const u = `${C.api(C.LEADS)}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;
    const rr = await afetch(u, { headers: C.rH });
    if (!rr.ok) return { err: reply({ error: 'airtable_read', status: rr.status, detail: await rr.text() }, 502) };
    return { rec: (await rr.json()).records?.[0] || null };
  };
  let leadId = null, leadFields = null;
  for (const formula of [
    handle ? `LOWER({@handle IG})='${esc(handle.toLowerCase())}'` : null,
    subId ? `{MC subscriber id}='${esc(subId)}'` : null,
    telefono ? `{WhatsApp}='${esc(telefono)}'` : null,
  ].filter(Boolean)) {
    const r = await findLead(formula);
    if (r.err) return r.err;
    if (r.rec) { leadId = r.rec.id; leadFields = r.rec.fields; break; }
  }

  let leadCreado = false;
  if (!leadId) {
    const cr = await afetch(C.api(C.LEADS), {
      method: 'POST', headers: C.wH,
      body: JSON.stringify({ typecast: true, fields: {
        ...(handle ? { '@handle IG': handle } : {}),
        // Sin canal declarado se asume DM IG, que es de donde venía el 100% del
        // tráfico hasta que se abrió WhatsApp. Nunca vacío: un `Canal origen` en
        // blanco manda el lead a la puerta «Sin canal registrado» del tablero.
        'Canal origen': canal || 'DM IG',
        'Estado': 'nuevo',
        'Fecha primer contacto': now,
        'Fecha última interacción': now,
        ...(subId ? { 'MC subscriber id': subId } : {}),
        ...(telefono ? { 'WhatsApp': telefono } : {}),
      } }),
    });
    if (!cr.ok) return reply({ error: 'airtable_lead_create', status: cr.status, detail: await cr.text() }, 502);
    leadId = (await cr.json()).id; leadCreado = true;
    leadFields = {};
  }

  // ── 2 · Lead: contacto + opt-in ────────────────────────────────────────────
  // OJO: sin `Fecha visita` (un llamado no es una visita: escribirla dispararía
  // el motor de recordatorios de visita).
  const upd = { 'Fecha última interacción': now };
  if (telefono) upd['WhatsApp'] = telefono;
  // CONSENTIMIENTO: lo captura el BOT, no Luis. Al pedir el número, el mensaje de
  // confirmación declara literalmente «si no te pilla, te deja un WhatsApp a ese
  // mismo número» — la persona entrega el teléfono DESPUÉS de leer eso, así que
  // el opt-in queda otorgado ahí, con testigo y fecha.
  // ⚠️ Cubre mensajes TRANSACCIONALES sobre lo que la persona pidió. NO cubre
  // marketing (`reactivacion_stock`, `seguimiento_suelto`): eso tiene su propio permiso.
  if (telefono || optin) { upd['Opt-in WhatsApp'] = true; upd['Fecha opt-in'] = today; }
  if (subId && !leadFields?.['MC subscriber id']) upd['MC subscriber id'] = subId;
  if (handle && !leadFields?.['@handle IG']) upd['@handle IG'] = handle;
  // ETAPA «teléfono» del embudo V2 — la métrica #1 del negocio. Se sella UNA sola
  // vez: si el lead vuelve por otro reel, la fecha original no se pisa, para no
  // falsear la cohorte de la semana.
  if (telefono && !leadFields?.['Fecha teléfono']) upd['Fecha teléfono'] = now;
  const lp = await afetch(`${C.api(C.LEADS)}/${leadId}`, {
    method: 'PATCH', headers: C.wH,
    body: JSON.stringify({ typecast: true, fields: upd }),
  });
  if (!lp.ok) return reply({ error: 'airtable_lead_update', status: lp.status, detail: await lp.text() }, 502);

  // ── 2b · La bici de interés ────────────────────────────────────────────────
  // Tres vías, por orden de confianza: recId directo (Puerta 2) → Post ID del
  // reel (Puerta 1) → Referencia (Puerta 3, los botones del sitio). Best-effort:
  // sin bici el ticket igual se crea.
  let biciId = biciIn;
  if (!biciId && reel) {
    const u = `${C.api(C.REELS)}?maxRecords=1&filterByFormula=${encodeURIComponent(`{Post ID Instagram}='${esc(reel)}'`)}`;
    const rr = await afetch(u, { headers: C.rH });
    if (rr.ok) biciId = linkIds((await rr.json()).records?.[0]?.fields?.Bici)[0] || '';
  }
  if (!biciId && ref) {
    const u = `${C.api('Inventario')}?maxRecords=1&filterByFormula=${encodeURIComponent(`{Referencia}='${esc(ref)}'`)}`;
    const rr = await afetch(u, { headers: C.rH });
    if (rr.ok) biciId = (await rr.json()).records?.[0]?.id || '';
  }

  let biciNombre = '';
  if (biciId) {
    const br = await afetch(`${C.api('Inventario')}/${biciId}`, { headers: C.rH });
    if (br.ok) { const bf = (await br.json()).fields || {}; biciNombre = bf.Modelo || bf.Etiqueta || ''; }
  }

  // 🔴 EL NOMBRE SE CALCULA ACÁ, ANTES DE LA RAMA DE DEDUP.
  // Hasta el 2026-08-19 esta línea vivía DESPUÉS del bloque de dedup, pero el
  // texto del aviso «🔁 VOLVIÓ» la usaba: `const` en zona muerta temporal →
  // ReferenceError → la función reventaba con 500. Sólo pasaba en la rama más
  // valiosa del sistema (el lead que YA dejó su número y vuelve a preguntar por
  // otra bici), y ManyChat recibía un error en vez de la confirmación.
  const nombre = leadFields?.Nombre || (handle ? '@' + handle : (telefono || 'Lead sin nombre'));

  // ── 2c · Contexto de la conversación, para quien va a llamar ───────────────
  // Lo pidió Gabriel: «que quien llame supiera más de la conversación que el bot
  // tuvo». Sale del CRM (intereses, tickets y avisos previos del lead), no de
  // ManyChat. Best-effort: si falla, el aviso sale igual, sin contexto.
  const ctx = await contextoLead(env, { leadId, leadFields: leadCreado ? null : leadFields });

  // Arma el texto del aviso por segmentos, del más accionable al menos, porque
  // `unaLinea` corta por el final: lo que se pierde al truncar es lo prescindible.
  const armarResumen = (prefijo) => unaLinea([
    prefijo,
    nombre,
    telefono || 'SIN TELÉFONO',
    canal ? `por ${canal}` : '',
    ciudad ? `de ${ciudad}` : '',
    biciNombre ? `pregunta por ${biciNombre}` : '',
    ctx.linea,
    mensaje ? `dijo: «${mensaje}»` : '',
    llamarEl ? `pidió que lo llamen el ${diaLegible(llamarEl)}` : '',
    franjaPref ? `prefiere ${franjaPref.toLowerCase()}` : '',
  ].filter(Boolean).join(' · '));

  // ── 3 · Dedup: ¿este lead ya tiene un llamado abierto? ─────────────────────
  // El comprador más caliente es justo el que comenta en dos o tres reels y deja
  // el teléfono en cada uno. Sin esto, Luis ve tres filas del mismo nombre: o
  // llama tres veces (queda como spam) o llama una y las otras dos ensucian la
  // cola y la métrica de «nunca llamados».
  //
  // ⚠️ LA COLA SE LEE POR `Salida`, NO POR `Estado`. `Salida` es el único campo
  // que toca Luis (arrastra la tarjeta); `Estado` es un espejo que mantiene el
  // código y que ya se desincronizó una vez en producción, dejando tickets
  // cerrados apareciendo en el briefing durante 13 días.
  //
  // 🔴 Y NO se busca con `FIND(leadId, ARRAYJOIN({Lead}))`. En una fórmula de
  // Airtable, un campo de enlace se evalúa a su valor VISIBLE (el campo primario
  // del registro enlazado), no al record id: esa comparación da 0 SIEMPRE.
  // Verificado contra la base real — `FIND('recd22Zyk…', ARRAYJOIN({Lead}))`
  // devuelve 0 filas y `FIND('nspringm2020', …)` devuelve 1. Es el mismo error
  // que tiene hoy `mc-rellamar` y que hace que el botón «Sí, llámenme» no
  // encuentre NUNCA el ticket.
  //
  // La forma correcta es el enlace INVERSO (`Leads.Llamados`), que sí trae ids,
  // acotado con `RECORD_ID()`. De paso es una consulta más barata: sólo mira los
  // tickets de esta persona en vez de traerse la cola entera.
  let abierto = null;
  const ticketsDelLead = linkIds(leadFields?.['Llamados']).slice(-20);
  if (ticketsDelLead.length) {
    try {
      const porId = ticketsDelLead.map(id => `RECORD_ID()='${esc(id)}'`).join(', ');
      const f = `AND(${COLA_LLAMADOS}, OR(${porId}))`;
      const fr = await afetch(`${C.api(C.LLAM)}?pageSize=50&filterByFormula=${encodeURIComponent(f)}`, { headers: C.rH });
      if (fr.ok) {
        const recs = (await fr.json()).records || [];
        recs.sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)));
        abierto = recs[0] || null;
      }
    } catch { /* best-effort: si falla la búsqueda, se crea uno nuevo */ }
  }

  // El horario real de quien va a llamar, para la promesa al cliente.
  const equipoLlamadas = await atiendenClientes(env);
  const pl = promesaLlamada(env, ahora, horarioUnion(equipoLlamadas, env));

  if (abierto) {
    const extra = [
      abierto.fields?.Notas || '',
      `+ ${today}: volvió${biciNombre ? ` preguntando por ${biciNombre}` : ''}${canal ? ` (${canal})` : ''}${notas ? ' · ' + notas : ''}${mensaje ? ` · dijo: «${mensaje}»` : ''}`,
    ].filter(Boolean).join('\n');
    const pr = await afetch(`${C.api(C.LLAM)}/${abierto.id}`, {
      method: 'PATCH', headers: C.wH,
      body: JSON.stringify({ typecast: true, fields: {
        'Notas': extra.slice(0, 2000),
        ...(telefono && !abierto.fields?.['Teléfono'] ? { 'Teléfono': telefono } : {}),
        ...(canal && !abierto.fields?.['Canal'] ? { 'Canal': canal } : {}),
      } }),
    });
    // ⚠️ Si el PATCH falla NO se cae al camino normal. Antes sí, y eso creaba un
    // SEGUNDO ticket del mismo lead —justo lo que el dedup existe para evitar—
    // más un segundo aviso. Un fallo al anotar la nota es un problema menor;
    // duplicar la cola de Luis y falsear la métrica de «nunca llamados» no lo es.
    {
      // LA RAMA DE DEDUP NO ES MUDA: si el mismo lead vuelve tres días después
      // por otro reel, alguien tiene que enterarse. Pero la guarda es POR TIEMPO,
      // no por «ya existe un ticket»: una ráfaga de tres reels en la misma tarde
      // produce UN aviso.
      const selloPrev = abierto.fields?.['Aviso equipo enviado'] ? new Date(abierto.fields['Aviso equipo enviado']).getTime() : 0;
      const enfriando = selloPrev && (ahora.getTime() - selloPrev) < REARME_MIN * 60000;
      // Sello vacío = entró cuando no había nadie y NADIE se ha enterado todavía:
      // se deja como está para que el briefing lo liste. Re-avisar acá sería
      // saltarse la red.
      let avisoDedup = selloPrev ? 'omitido_rearme' : 'pendiente_de_briefing';
      let destinos = null;

      if (selloPrev && !enfriando) {
        const res = await avisar(env, {
          tipo: 'llamada', flowEnv: 'FLOW_NS_LLAMADO', campo: 'cf_llamado_datos',
          texto: armarResumen('🔁 VOLVIÓ'), now: ahora,
        });
        destinos = res.destinatarios;
        if (res.puedeSellar) {
          avisoDedup = 'enviado';
          await afetch(`${C.api(C.LLAM)}/${abierto.id}`, {
            method: 'PATCH', headers: C.wH,
            body: JSON.stringify({ typecast: true, fields: { 'Aviso equipo enviado': now } }),
          });
        } else if (quedaPendiente(res.motivo)) {
          // Nadie en turno: se BORRA el sello para que vuelva a la cola de la red.
          // Es la única forma de que el briefing de mañana cuente que volvió.
          avisoDedup = 'pendiente_de_briefing';
          await afetch(`${C.api(C.LLAM)}/${abierto.id}`, {
            method: 'PATCH', headers: C.wH,
            body: JSON.stringify({ typecast: true, fields: { 'Aviso equipo enviado': null } }),
          });
        } else {
          avisoDedup = `sin_enviar:${res.motivo}`;
        }
      }

      return reply({ ok: true, llamadoId: abierto.id, leadId, leadCreado, dedup: true,
        biciNombre: biciNombre || null, llamarEl: null, llamarElLegible: null,
        aviso: avisoDedup, destinatarios: destinos, contexto: ctx.linea || null,
        notaGuardada: pr.ok,
        // ManyChat imprime la misma confirmación en los dos caminos; la rama de
        // dedup los omitía y quedaba un mensaje mocho (bug B6 del runbook).
        promesaLlamada: pl.promesa, dentroDeHorario: pl.abierto });
    }
  }

  // ── 4 · Crear el ticket ────────────────────────────────────────────────────
  const lr = await afetch(C.api(C.LLAM), {
    method: 'POST', headers: C.wH,
    body: JSON.stringify({ typecast: true, fields: {
      'Nombre': nombre,
      'Estado': 'Llamada pendiente',
      // `Salida` gobierna el Kanban. Se escribe acá en vez de depender de la
      // automatización «Kanban: Salida vacía → Llamada pendiente»: una pieza
      // menos en el camino, y la tarjeta nace ya en su columna.
      'Salida': 'Llamada pendiente',
      'Origen': 'Bot DM',
      'Fecha': today,
      'Lead': [leadId],
      ...(canal ? { 'Canal': canal } : {}),
      ...(telefono ? { 'Teléfono': telefono } : {}),
      ...(ciudad ? { 'Ciudad': ciudad } : {}),
      ...(franjaPref ? { 'Franja': franjaPref } : {}),
      ...(llamarEl ? { 'Llamar el': llamarEl } : {}),
      ...(biciId ? { 'Bici de interés': [biciId] } : {}),
      ...(notas || mensaje ? { 'Notas': unaLinea([notas, mensaje ? `dijo: «${mensaje}»` : ''].filter(Boolean).join(' · '), 2000) } : {}),
    } }),
  });
  if (!lr.ok) return reply({ error: 'airtable_llamado_create', status: lr.status, detail: await lr.text() }, 502);
  const llamadoId = (await lr.json()).id;

  // ── 5 · El aviso al equipo + el sello ──────────────────────────────────────
  // Con alguien en turno se avisa AL TIRO y no por el barrido: la velocidad de la
  // primera llamada es LA métrica del negocio, y 15 minutos de latencia sobre un
  // lead que acaba de dejar su número son caros.
  //
  // Sin nadie en turno NO se manda nada y —esto es lo importante— el sello
  // `Aviso equipo enviado` queda VACÍO. Ese vacío es lo que hace que el briefing
  // de la mañana lo liste con su acción pendiente, y que `cron-avisos` lo mande
  // en cuanto alguien entre a su turno.
  //
  // Si el envío falla, tampoco se sella: el barrido reintenta en el próximo tick.
  const res = await avisar(env, {
    tipo: 'llamada', flowEnv: 'FLOW_NS_LLAMADO', campo: 'cf_llamado_datos',
    texto: armarResumen('📞 LLAMAR'), now: ahora,
  });
  let aviso = quedaPendiente(res.motivo) ? 'pendiente_de_briefing' : `sin_enviar:${res.motivo}`;
  if (res.puedeSellar) {
    aviso = 'enviado';
    await afetch(`${C.api(C.LLAM)}/${llamadoId}`, {
      method: 'PATCH', headers: C.wH,
      body: JSON.stringify({ typecast: true, fields: { 'Aviso equipo enviado': now } }),
    });
  }

  return reply({
    ok: true, llamadoId, leadId, leadCreado, dedup: false,
    canal: canal || null, biciNombre: biciNombre || null,
    llamarEl: llamarEl || null, llamarElLegible: llamarEl ? diaLegible(llamarEl) : null,
    aviso, destinatarios: res.destinatarios, contexto: ctx.linea || null,
    promesaLlamada: pl.promesa, dentroDeHorario: pl.abierto,
  });
}

// GET — describe el contrato (para montar el flujo en ManyChat sin adivinar).
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return reply({ error: 'unauthorized' }, 401);
  const equipo = await atiendenClientes(env);
  const pl = promesaLlamada(env, new Date(), horarioUnion(equipo, env));
  return reply({
    ok: true,
    que: 'Entrada común de «alguien dejó su teléfono». Crea el ticket en Llamados y avisa al equipo en su horario.',
    identificadores: ['handle', 'subscriber_id', 'telefono'],
    body: {
      handle: 'sin arroba (Instagram)', subscriber_id: 'id de ManyChat (el único estable en WhatsApp)',
      telefono: 'el número a llamar', canal: Object.values(CANALES).filter((v, i, a) => a.indexOf(v) === i),
      mensaje: 'lo último que escribió', ciudad: '', franja: 'Mañana | Tarde',
      dia: 'hoy | mañana | lunes… | YYYY-MM-DD', bici: 'recId', reel: 'Post ID', ref: 'Referencia', notas: '',
    },
    alias: '/api/mc-llamado apunta a este mismo endpoint',
    atiendenClientes: equipo.map(p => ({ nombre: p.nombre, horario: p.horario || '(franja general)' })),
    horarioVigente: horarioUnion(equipo, env) || `(default) ${HORARIO_DEFAULT}`,
    promesaAhora: pl.promesa,
  });
}
