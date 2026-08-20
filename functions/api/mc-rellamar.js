// Cloudflare Pages Function · POST /api/mc-rellamar
//
// EL BOTÓN «Sí, llámenme» de la plantilla `llamada_no_contestada_v2`.
//
// Cuando Luis marca «No contestado», al lead le llega un WhatsApp con UN botón.
// Al pulsarlo, ManyChat pega acá y este endpoint devuelve el ticket a la cola.
//
// LA REGLA QUE NO SE NEGOCIA: **nunca crea un registro nuevo.** Mueve el que ya
// existe. Un ticket duplicado por persona ensucia la cola de Luis, rompe el dedup
// de `mc-llamado` y falsea la métrica de «nunca llamados».
//
// LO QUE HACE, EN UN SOLO PATCH:
//   · `Salida` y `Estado` → «Llamada pendiente» (vuelve a la primera columna)
//   · limpia `Aviso salida enviado` → si vuelve a no contestar, el rescate puede
//     volver a salir (sin esto el sello lo bloquea para siempre)
//   · `Pidió rellamada` = ahora · `Reaperturas` +1
//   · deja `Aviso equipo enviado` RESUELTO: con fecha si avisó, vacío si estaba
//     fuera de franja. Nunca existe un estado intermedio observable.
//
// EL HORARIO NO SE DECIDE ACÁ DOS VECES: lo resuelve `avisar()` de lib/avisos.js,
// igual que el barrido. Con alguien en su turno avisa al tiro; sin nadie, el
// sello queda vacío y lo recoge el briefing de la mañana.
//
// Body: { subscriber_id?, handle? }   (ManyChat manda los dos; basta uno)
// Protegido por MC_KEY (?key=).

import { avisar, unaLinea, chileHora } from '../../lib/avisos.js';
import { avisarHumano } from './aviso-humano.js';

const JSONH = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSONH });
const BASE_DEFAULT = 'appQUgk8aeD752923';

// Si al equipo ya se le avisó de este ticket hace menos de esto, se re-encola
// pero NO se vuelve a avisar. Evita que dos toques seguidos del botón —o un toque
// justo después de que el barrido ya avisó— produzcan dos WhatsApps al equipo.
const REARME_MIN = 120;

// A partir de acá el ticket vuelve a la cola pero ya no se manda más rescate:
// si en 3 vueltas no cerró, insistir con una plantilla de Marketing molesta.
const MAX_REAPERTURAS = 3;

async function afetch(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, opts);
    if (r.status !== 429 || i >= tries - 1) return r;
    await new Promise(res => setTimeout(res, 1200 * (i + 1)));
  }
}

const keyOk = (env, url) => { const need = env.MC_KEY; return need ? url.searchParams.get('key') === need : true; };
const clean = (v, max = 80) => { const s = String(v ?? '').trim(); return !s || s.includes('{{') ? '' : s.slice(0, max); };
const esc = (s) => String(s).replace(/'/g, "\\'");
const linkIds = (v) => (Array.isArray(v) ? v : (v ? [v] : [])).map(x => (typeof x === 'string' ? x : x?.id)).filter(Boolean);

// Aviso de «esto necesita una persona». Se usa en todos los caminos raros: sin
// ticket, sin lead, ticket ya avanzado, tope de reaperturas. Nunca se responde
// con silencio a alguien que apretó un botón.
// 🔴 Desde 2026-08-19 pasa por `avisarHumano` —la entrada común— en vez de mandar
// el WhatsApp por su cuenta. La diferencia no es cosmética: así estos casos
// quedan REGISTRADOS en la tabla `Avisos` y entran a la cola del briefing. Antes
// se mandaban y, si nadie estaba mirando el teléfono en ese momento, no quedaba
// ningún rastro que alguien fuera a revisar después: alguien apretaba un botón
// pidiendo que lo llamaran y el sistema lo olvidaba.
async function derivar(env, texto, ident = {}) {
  return avisarHumano(env, {
    handle: ident.handle || '', subId: ident.subId || '',
    canal: 'WhatsApp', motivo: unaLinea(texto),
  });
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return reply({ error: 'unauthorized' }, 401);

  let data;
  try { data = await request.json(); } catch { return reply({ error: 'bad_json' }, 400); }

  const handle = clean(data?.handle, 60).replace(/^@/, '');
  const subId = clean(data?.subscriber_id, 40);
  if (!handle && !subId) return reply({ error: 'missing_fields (handle o subscriber_id)' }, 422);

  const BASE = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  const WRITE = env.AIRTABLE_WRITE_TOKEN;
  if (!READ || !WRITE) return reply({ error: 'not_configured' }, 503);

  const LLAM = env.AIRTABLE_LLAMADOS_TABLE || 'Llamados';
  const LEADS = env.AIRTABLE_LEADS_TABLE || 'Leads';
  const api = (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`;
  const rH = { Authorization: `Bearer ${READ}` };
  const wH = { Authorization: `Bearer ${WRITE}`, 'Content-Type': 'application/json' };
  const now = new Date();
  const nowIso = now.toISOString();
  const quien = handle ? `@${handle}` : `sid ${subId}`;

  // 1) El Lead. Sin él no hay a qué ticket llegar.
  let leadId = null, leadNombre = '', leadTickets = [];
  for (const formula of [
    handle ? `LOWER({@handle IG})='${esc(handle.toLowerCase())}'` : null,
    subId ? `{MC subscriber id}='${esc(subId)}'` : null,
  ].filter(Boolean)) {
    const rr = await afetch(`${api(LEADS)}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`, { headers: rH });
    if (!rr.ok) continue;
    const rec = ((await rr.json()).records || [])[0];
    if (rec) {
      leadId = rec.id;
      leadNombre = rec.fields?.Nombre || rec.fields?.Lead || '';
      leadTickets = linkIds(rec.fields?.Llamados).slice(-20);
      break;
    }
  }
  if (!leadId) {
    await derivar(env, `${quien} apretó «Sí, llámenme» pero no tiene ficha en el CRM. Búscalo en ManyChat y llámalo.`, { handle, subId });
    return reply({ ok: true, accion: 'derivado_a_humano', motivo: 'lead_no_encontrado' });
  }

  // 2) Su ticket más reciente. Se lee la cola completa de ese lead y se elige por
  //    fecha de creación: un lead puede tener varios si comentó en varios reels.
  // 🔴 ACÁ HABÍA UN BUG QUE APAGABA EL BOTÓN ENTERO (cazado 2026-08-19).
  // La consulta era `FIND('<leadId>', ARRAYJOIN({Lead}))`. En una fórmula de
  // Airtable, un campo de enlace se evalúa a su valor VISIBLE (el campo primario
  // del registro enlazado) y NO al record id, así que esa comparación daba 0
  // SIEMPRE. Verificado contra la base real: `FIND('recd22Zyk…', ARRAYJOIN({Lead}))`
  // → 0 filas; `FIND('nspringm2020', …)` → 1 fila.
  //
  // Consecuencia: TODO el que apretaba «Sí, llámenme» caía en `sin_ticket` y se
  // derivaba a un humano —«no tiene ningún ticket abierto, créaselo»— aunque su
  // ticket estuviera ahí. El botón nunca reencoló nada.
  //
  // La forma correcta es el enlace inverso `Leads.Llamados`, que sí trae ids,
  // acotado con `RECORD_ID()`.
  let tickets = [];
  if (leadTickets.length) {
    const porId = `OR(${leadTickets.map(id => `RECORD_ID()='${esc(id)}'`).join(', ')})`;
    const lr = await afetch(`${api(LLAM)}?pageSize=50&filterByFormula=${encodeURIComponent(porId)}`, { headers: rH });
    tickets = lr.ok ? ((await lr.json()).records || []) : [];
  }
  tickets.sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)));
  const t = tickets[0];

  if (!t) {
    await derivar(env, `${leadNombre || quien} apretó «Sí, llámenme» pero no tiene ningún ticket abierto. Créaselo y llámalo.`, { handle, subId });
    return reply({ ok: true, accion: 'derivado_a_humano', motivo: 'sin_ticket', leadId });
  }

  const f = t.fields || {};
  const salida = typeof f['Salida'] === 'string' ? f['Salida'] : (f['Salida']?.name || '');
  const estado = typeof f['Estado'] === 'string' ? f['Estado'] : (f['Estado']?.name || '');
  const reaperturas = Number(f['Reaperturas'] || 0);

  // 3) SEGUNDO TOQUE. El ticket ya está en la cola: se anota y se responde igual
  //    de bien, pero no se re-avisa ni se toca ningún sello. Apretar dos veces no
  //    puede producir dos WhatsApps al equipo.
  if (salida === 'Llamada pendiente') {
    await afetch(`${api(LLAM)}/${t.id}`, {
      method: 'PATCH', headers: wH,
      body: JSON.stringify({ typecast: true, fields: {
        'Pidió rellamada': nowIso,
        'Notas': unaLinea([f['Notas'] || '', `+ ${nowIso.slice(0, 10)}: volvió a apretar «Sí, llámenme» (ya estaba en la cola)`].filter(Boolean).join('\n'), 2000),
      } }),
    });
    return reply({ ok: true, accion: 'ya_en_cola', llamadoId: t.id, leadId });
  }

  // 4) TICKET YA AVANZADO. Si la persona apretó el botón de un mensaje viejo
  //    cuando su caso ya siguió otro camino (visita agendada, región, encargo,
  //    o cerrado), NO se toca. Devolverlo a la cola sacaría una visita del Kanban
  //    y podría dispararle al cliente una segunda confirmación de visita.
  if (salida && salida !== 'No contestado') {
    await derivar(env, `${leadNombre || quien} apretó «Sí, llámenme», pero su ticket ya está en «${salida}». No lo moví: revísalo tú.`, { handle, subId });
    return reply({ ok: true, accion: 'derivado_a_humano', motivo: 'ticket_ya_avanzado', salida, llamadoId: t.id, leadId });
  }
  if (estado === 'Cerrada') {
    await derivar(env, `${leadNombre || quien} apretó «Sí, llámenme» sobre un ticket ya cerrado. Revísalo tú.`, { handle, subId });
    return reply({ ok: true, accion: 'derivado_a_humano', motivo: 'ticket_cerrado', llamadoId: t.id, leadId });
  }

  // 5) TOPE DE INSISTENCIA. Vuelve a la cola igual —la persona lo pidió— pero se
  //    avisa a una persona en vez de seguir el ciclo automático.
  const agotado = reaperturas >= MAX_REAPERTURAS;

  // 6) ¿Avisamos ahora o lo recoge el briefing? Misma función que el barrido:
  //    la regla de la hora vive en UN solo lugar.
  const selloPrevio = f['Aviso equipo enviado'] ? new Date(f['Aviso equipo enviado']).getTime() : 0;
  const enfriando = selloPrevio && (now.getTime() - selloPrevio) < REARME_MIN * 60000;

  let aviso = 'pendiente_de_briefing';
  let sello = null;
  let dentro = true;

  if (enfriando) {
    // Al equipo ya se le avisó hace poco: se re-encola sin volver a sonar, pero
    // se CONSERVA el sello viejo para no reabrir la ventana de reintentos.
    aviso = 'omitido_rearme';
    sello = f['Aviso equipo enviado'];
  } else {
    // Quién está en turno lo decide `avisar` con la tabla `Equipo`; acá ya no se
    // pregunta la hora por separado. Sin nadie en turno el sello queda vacío y el
    // caso viaja en el briefing de la mañana — que es lo que pidió Gabriel.
    const res = await avisar(env, {
      tipo: 'llamada', flowEnv: 'FLOW_NS_LLAMADO', campo: 'cf_llamado_datos',
      texto: `🔁 ${f['Nombre'] || leadNombre || quien} · ${f['Teléfono'] || 'sin teléfono'} · PIDIÓ que lo llamen de vuelta (apretó el botón del WhatsApp)`,
      now,
    });
    dentro = res.motivo !== 'fuera_de_horario';
    if (res.puedeSellar) { aviso = 'enviado'; sello = nowIso; }
    else if (!dentro) { aviso = 'pendiente_de_briefing'; sello = null; }
    else { aviso = `sin_enviar:${res.motivo}`; sello = null; }  // sin sello → el barrido reintenta
  }

  // 7) UN SOLO PATCH, con todo resuelto. No existe un instante en que el ticket
  //    esté a medio camino.
  const campos = {
    'Salida': 'Llamada pendiente',
    'Estado': 'Llamada pendiente',
    'Aviso salida enviado': null,   // el rescate podrá volver a salir
    'Pidió rellamada': nowIso,
    'Reaperturas': reaperturas + 1,
    'Notas': unaLinea([
      f['Notas'] || '',
      `+ ${nowIso.slice(0, 10)}: apretó «Sí, llámenme» en el WhatsApp → vuelve a la cola${dentro ? '' : ' (fuera de horario: va en el briefing)'}`,
    ].filter(Boolean).join('\n'), 2000),
  };
  if (sello) campos['Aviso equipo enviado'] = sello;
  else campos['Aviso equipo enviado'] = null;

  const pr = await afetch(`${api(LLAM)}/${t.id}`, {
    method: 'PATCH', headers: wH, body: JSON.stringify({ typecast: true, fields: campos }),
  });
  if (!pr.ok) return reply({ error: 'airtable_patch', status: pr.status, detalle: (await pr.text()).slice(0, 200) }, 502);

  if (agotado) {
    await derivar(env, `${leadNombre || quien} pidió que lo llamaran por ${reaperturas + 1}ª vez. Ya no se le manda más rescate automático: llámalo tú.`, { handle, subId });
  }

  return reply({
    ok: true, accion: 'reencolado', llamadoId: t.id, leadId,
    aviso, dentroDeFranja: dentro, hora: chileHora(now),
    reaperturas: reaperturas + 1, topeAlcanzado: agotado,
  });
}
// Sólo POST.
