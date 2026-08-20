// Cloudflare Pages Function · POST /api/salida-llamado
// El motor de POST-LLAMADA del embudo V2. Lo dispara una automatización de
// Airtable cuando Luis marca `Salida` en un ticket de `Llamados`.
//
// Cierra de una vez los tres huecos que rompían en silencio:
//   1. EL CONSENTIMIENTO LLEGA A DONDE SE LEE — los motores (cron-recordatorios,
//      cron-reenganche) filtran por `Opt-in WhatsApp` en el LEAD. El opt-in lo
//      escribe `mc-llamado` al capturar el número; acá va la red de seguridad
//      para tickets manuales y leads viejos. Sin eso el barrido devuelve 0 sin
//      dar error y nadie recibe confirmación ni recordatorios.
//   2. LA VISITA INVISIBLE — una visita agendada por teléfono no existía para el
//      sistema: nadie escribía `Leads.Fecha visita` ni el `Estado`. Sin eso no
//      salen recordatorios y el tablero muestra «Agendó: 0» aunque Luis agende diez.
//   3. EL MENSAJE AUTOMÁTICO — dispara la plantilla de WhatsApp que corresponde a
//      cada salida, una sola vez (sello de idempotencia `Aviso salida enviado`).
//
// Body: { llamadoId: "recXXX" }   (la automatización manda el id del ticket)
// Lee con AIRTABLE_TOKEN, escribe con AIRTABLE_WRITE_TOKEN. Protegido por MC_KEY.

import { avisar, quedaPendiente,
} from '../../lib/avisos.js';

const JSONH = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSONH });

const BASE_DEFAULT = 'appQUgk8aeD752923';

// Salida que marca Luis (arrastrando la tarjeta en el Kanban) → qué pasa.
//
// ⚠️ LOS NOMBRES SON MATCH EXACTO contra las opciones del select `Salida` en
// Airtable. Si no calzan, este endpoint no encuentra la salida y NO dispara nada,
// en silencio. Al agregar u ordenar opciones en Airtable, actualizar acá.
// Las 6 opciones del campo son: `Llamada pendiente` (la cola, no dispara nada) +
// las 5 de abajo.
//
// `flowEnv`      = variable de Cloudflare con el namespace del flujo de ManyChat.
// `estadoLead`   = a qué estado avanza el LEAD (con guarda de no-regresión).
// `copiaVisita`  = si esta salida copia la fecha de visita al Lead.
//
// ⚠️ El estado del TICKET ya NO se declara acá: vive en `ESTADO_POR_SALIDA`, más
// abajo, y se escribe ANTES que cualquier otra cosa. Tenerlo en dos mapas era
// pedir que se desincronizaran.
//
// El consentimiento NO se pide acá: lo captura el bot al pedir el número (ver
// `aviso-llamada`). Los cuatro mensajes son TRANSACCIONALES sobre algo que la
// persona pidió —su visita, su encargo, su llamada— así que ninguno depende de
// que Luis marque una casilla. Marketing es otra cosa y tiene su propio permiso.
const SALIDAS = {
  'Visita agendada':     { flowEnv: 'FLOW_NS_CONFIRMACION', estadoLead: 'visita_agendada', copiaVisita: true },
  'Coordinación región': { flowEnv: 'FLOW_NS_REGION',       estadoLead: null,              copiaVisita: false },
  'Encargo de búsqueda': { flowEnv: 'FLOW_NS_ENCARGO',      estadoLead: null,              copiaVisita: false },
  // El ticket VUELVE a la cola: no contestar no cierra nada, es la bandeja de reintentos.
  'No contestado':       { flowEnv: 'FLOW_NS_NO_CONTESTA',  estadoLead: null,              copiaVisita: false },
  // Habló y no va a avanzar. Cierra el ticket sin mandar nada, a propósito.
  'Sin interés':         { flowEnv: null,                   estadoLead: null,              copiaVisita: false },
};

async function afetch(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, opts);
    if (r.status !== 429 || i >= tries - 1) return r;
    await new Promise(res => setTimeout(res, 1200 * (i + 1)));
  }
}

const keyOk = (env, url) => { const need = env.MC_KEY; return need ? url.searchParams.get('key') === need : true; };
const linkId = (v) => { const a = Array.isArray(v) ? v[0] : v; return (typeof a === 'string' ? a : a?.id) || ''; };

// ⚠️ Este helper IGNORABA el resultado. Si ManyChat rechazaba la escritura del
// campo, el flujo se disparaba igual —con la variable vieja o vacía— y el sello
// de idempotencia se estampaba: el cliente recibía «te confirmamos tu visita
// para {{cf_fecha_visita}}» con la fecha de otra visita, o en blanco, y no había
// forma de reintentar. Ahora lanza, el catch de abajo lo reporta y, al no
// sellarse, el próximo disparo lo vuelve a intentar.
async function mcSetField(token, sid, name, value) {
  const r = await afetch('https://api.manychat.com/fb/subscriber/setCustomFieldByName', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscriber_id: sid, field_name: name, field_value: value }),
  });
  if (!r.ok) throw new Error(`setField ${name} ${r.status}: ${(await r.text()).slice(0, 160)}`);
}
async function mcSendFlow(token, sid, flowNs) {
  const r = await afetch('https://api.manychat.com/fb/sending/sendFlow', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscriber_id: sid, flow_ns: flowNs }),
  });
  if (!r.ok) throw new Error(`sendFlow ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

// El horario vive en `lib/avisos.js`. Acá había una de las SEIS copias de
// `horarioOk` que se eliminaron el 2026-08-06 (ver el encabezado de ese archivo).
//
// ⛔ NO agregar `'Llamada pendiente'` al mapa SALIDAS de arriba. Es tentador —el
// botón de rescate y `mc-rellamar` escriben ese valor— pero rompería R1 en
// silencio: al no tener `flowEnv`, entraría por la rama `sin_mensaje_por_diseño`
// y RE-ESTAMPARÍA `Aviso salida enviado`, que es justo el sello que `mc-rellamar`
// acaba de limpiar para que el rescate pueda volver a salir. Sin la entrada, el
// endpoint devuelve `salida_sin_mensaje` y no toca el sello, que es lo correcto:
// arrastrar una tarjeta de vuelta a la cola no es un mensaje al cliente.
//
// ── `Estado` ES UN ESPEJO DE `Salida`, Y SE SINCRONIZA PRIMERO (2026-08-19) ──
// Bug real cazado en producción: el `Estado` del ticket se sincronizaba al FINAL,
// después de varias salidas tempranas. Dos de ellas lo saltaban:
//   · `sin_lead`   → un ticket manual sin Lead (Luis anotando una llamada suya)
//                    marcado «Sin interés» se quedaba en `Llamada pendiente`;
//   · `ya_enviado` → un ticket que ya había mandado un mensaje (p. ej. «No
//                    contestado» → rescate) y después se marcaba «Sin interés»
//                    tampoco cerraba: el sello del mensaje cortaba TODO.
// Resultado: el briefing de la mañana le repetía a Luis, día tras día, gente que
// él ya había marcado «Sin interés» (Rodrigo Riquelme, 13 días seguidos). Por eso
// el espejo se escribe ANTES de cualquier `return`, y por eso la cola (briefing,
// barrido, dedup) se lee por `Salida` —el campo que Luis toca— y no por `Estado`.
// `Estado` se mantiene porque lo usan la automatización de 1ª llamada histórica y
// las vistas viejas; pero ya no es de quien depende nada crítico.
const ESTADO_POR_SALIDA = {
  'Llamada pendiente':   'Llamada pendiente',   // vuelta a la cola (rescate, arrastre a mano)
  'Visita agendada':     'Llamado',
  'Coordinación región': 'Llamado',
  'Encargo de búsqueda': 'Llamado',
  'No contestado':       'Llamada pendiente',   // bandeja de reintentos, sigue abierto
  'Sin interés':         'Cerrada',
};

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return reply({ error: 'unauthorized' }, 401);

  let data;
  try { data = await request.json(); } catch { return reply({ error: 'bad_json' }, 400); }
  const llamadoId = String(data?.llamadoId || data?.recordId || '').trim();
  if (!llamadoId) return reply({ error: 'missing_fields (llamadoId)' }, 422);

  const BASE  = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ  = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  const WRITE = env.AIRTABLE_WRITE_TOKEN;
  if (!READ || !WRITE) return reply({ error: 'not_configured' }, 503);
  const api = (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`;
  const rH = { Authorization: `Bearer ${READ}` };
  const wH = { Authorization: `Bearer ${WRITE}`, 'Content-Type': 'application/json' };
  const now = new Date().toISOString();
  const today = new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10); // Chile UTC-4

  // 1) Leer el ticket (el GET de un registro único NO acepta ?fields[] → 422).
  const tr = await afetch(`${api('Llamados')}/${llamadoId}`, { headers: rH });
  if (!tr.ok) return reply({ error: 'llamado_not_found', status: tr.status }, 404);
  const t = (await tr.json()).fields || {};

  const salida = typeof t['Salida'] === 'string' ? t['Salida'] : (t['Salida']?.name || '');
  if (!salida) return reply({ ok: true, accion: 'sin_salida' });

  // 1b) EL ESPEJO, PRIMERO. Pase lo que pase más abajo (sin lead, ya enviado,
  //     lead borrado, falla del mensaje), el `Estado` del ticket queda alineado
  //     con lo que Luis arrastró. Es un PATCH propio y pequeño, a propósito.
  const estadoEspejo = ESTADO_POR_SALIDA[salida] || null;
  let estadoSincronizado = false;
  const estadoActualTicket = typeof t['Estado'] === 'string' ? t['Estado'] : (t['Estado']?.name || '');
  if (estadoEspejo && estadoActualTicket !== estadoEspejo) {
    const er = await afetch(`${api('Llamados')}/${llamadoId}`, {
      method: 'PATCH', headers: wH,
      body: JSON.stringify({ typecast: true, fields: { 'Estado': estadoEspejo } }),
    });
    estadoSincronizado = er.ok;
    if (er.ok) t['Estado'] = estadoEspejo;   // lo que sigue ve el valor ya alineado
  }

  const cfg = SALIDAS[salida];
  if (!cfg) return reply({ ok: true, accion: 'salida_sin_mensaje', salida, estadoTicket: estadoSincronizado ? estadoEspejo : null });

  // 2) IDEMPOTENCIA — pero SOLO del mensaje (2026-08-05). El WhatsApp sale una
  //    única vez; los DATOS del lead se refrescan siempre. Sin esto, las bicis
  //    elegidas después de poner la fecha nunca llegaban a `MC bici`, y un
  //    reagendo por teléfono dejaba los recordatorios corriendo sobre la fecha
  //    vieja — el sello cortaba todo, no solo el envío.
  const yaEnviado = !!t['Aviso salida enviado'];
  // Salidas sin visita que copiar: con el sello puesto no queda nada que refrescar.
  if (yaEnviado && !cfg.copiaVisita) return reply({ ok: true, accion: 'ya_enviado', salida });

  // 2b) CLASIFICAR ≠ COMPLETAR. El Kanban de Luis es para mover la tarjeta al
  //     tipo de petición, no para llenar formularios en medio de una llamada. El
  //     detalle se completa después, en la pantalla de cada caso.
  //     Consecuencia: una visita recién clasificada puede no tener fecha todavía.
  //     No se puede confirmar una visita sin fecha, así que acá NO se manda nada
  //     y —clave— NO se sella: cuando Luis ponga la fecha, este mismo endpoint
  //     corre de nuevo y ahí sí sale la confirmación. El ticket queda clasificado
  //     y visible en su columna mientras tanto.
  if (cfg.copiaVisita && !t['Fecha y hora de visita']) {
    // Con sello y sin fecha (fecha borrada tras enviar) no hay nada que hacer.
    // El espejo del Estado ya se escribió arriba, así que acá no hay nada más.
    if (yaEnviado) return reply({ ok: true, accion: 'ya_enviado', salida, estadoTicket: estadoEspejo });
    return reply({ ok: true, salida, accion: 'clasificado_sin_fecha', estadoTicket: estadoEspejo,
      nota: 'La visita quedó clasificada. La confirmación sale cuando se complete «Fecha y hora de visita».' });
  }

  const leadId = linkId(t['Lead']);
  // Ticket sin Lead enlazado (los que el staff crea a mano con el «+» del Kanban):
  // no hay a quién escribirle ni qué propagar, pero el ESPEJO ya se sincronizó
  // arriba — que es justo lo que faltaba y dejó a Rodrigo 13 días en el briefing.
  if (!leadId) return reply({ ok: true, accion: 'sin_lead', salida, estadoTicket: estadoEspejo, estadoSincronizado });

  const lr = await afetch(`${api('Leads')}/${leadId}`, { headers: rH });
  if (!lr.ok) return reply({ error: 'lead_not_found', status: lr.status }, 404);
  const lf = (await lr.json()).fields || {};

  // 3) PROPAGAR AL LEAD lo que Luis registró en el ticket.
  const upd = { 'Fecha última interacción': now };

  //   3a) Red de seguridad del consentimiento. El opt-in normal lo escribe
  //       `mc-llamado` al capturar el número (el bot lo declara en B6). Esto
  //       cubre el borde: tickets creados a mano por el staff, o leads viejos
  //       anteriores a ese cambio. Sin esto, los crons los filtran fuera y no
  //       reciben ni confirmación ni recordatorios, sin dar error.
  if (!lf['Opt-in WhatsApp'] && (t['Teléfono'] || t['Permiso WhatsApp'] === true)) {
    upd['Opt-in WhatsApp'] = true;
    upd['Fecha opt-in'] = today;
  }

  //   3b) La visita agendada por teléfono, para que el motor de recordatorios la vea.
  //       Al reagendar se limpian los sellos, igual que hace mc-agenda, para que
  //       el ciclo de recordatorios vuelva a correr sobre la fecha nueva.
  if (cfg.copiaVisita && t['Fecha y hora de visita']) {
    upd['Fecha visita'] = t['Fecha y hora de visita'];
    // Los sellos de recordatorio se limpian SOLO si la fecha cambió (reagendo).
    // Refrescar las bicis sin mover la fecha no debe re-armar un recordatorio
    // ya enviado — el cron lo mandaría de nuevo.
    const fechaAntes = lf['Fecha visita'] ? new Date(lf['Fecha visita']).getTime() : null;
    if (fechaAntes !== new Date(t['Fecha y hora de visita']).getTime()) {
      upd['Recordatorio 48h'] = null;
      upd['Recordatorio 8am'] = null;
      upd['Recordatorio 2h'] = null;
    }

    // Las bicis que Luis va a PREPARAR (máx 3). Se escriben como texto en
    // `MC bici` del Lead, que es el campo que ya leen el briefing (`biciDe`) y
    // los recordatorios (`cf_bici`). Así una sola escritura alimenta las dos
    // cosas y nadie tiene que mantener dos listas.
    const bicis = (Array.isArray(t['Bicis para la visita']) ? t['Bicis para la visita'] : [])
      .map(x => (typeof x === 'string' ? x : x?.id)).filter(Boolean).slice(0, 3);
    const nombres = [];
    for (const id of bicis) {
      const br = await afetch(`${api('Inventario')}/${id}`, { headers: rH });
      if (br.ok) { const bf = (await br.json()).fields || {}; if (bf.Modelo || bf.Etiqueta) nombres.push(bf.Modelo || bf.Etiqueta); }
    }
    // Si Luis no eligió ninguna, cae a la bici del reel: siempre hay algo que preparar.
    if (!nombres.length) {
      const bId = linkId(t['Bici de interés']);
      if (bId) {
        const br = await afetch(`${api('Inventario')}/${bId}`, { headers: rH });
        if (br.ok) { const bf = (await br.json()).fields || {}; if (bf.Modelo || bf.Etiqueta) nombres.push(bf.Modelo || bf.Etiqueta); }
      }
    }
    if (nombres.length) upd['MC bici'] = nombres.join(' · ').slice(0, 200);
  }

  //   3c) Estado del lead, con guarda: nunca retroceder un lead ya avanzado.
  const RANGO = { nuevo: 0, ficha_entregada: 1, quiz_iniciado: 1, quiz_abandonado: 2,
    match_entregado: 2, no_match: 2, visita_agendada: 3, visita_confirmada: 4,
    no_show: 5, 'visitó': 5, 'cerró': 6, muerto: 99, descartado: 99 };
  if (cfg.estadoLead) {
    const actual = lf['Estado'] || 'nuevo';
    if ((RANGO[cfg.estadoLead] ?? 999) >= (actual in RANGO ? RANGO[actual] : 0)) {
      upd['Estado'] = cfg.estadoLead;
    }
  }

  const lp = await afetch(`${api('Leads')}/${leadId}`, {
    method: 'PATCH', headers: wH, body: JSON.stringify({ typecast: true, fields: upd }),
  });
  if (!lp.ok) return reply({ error: 'airtable_lead_update', status: lp.status, detail: await lp.text() }, 502);

  // Mensaje ya enviado → los datos quedaron al día y acá se corta: ni WhatsApp
  // nuevo, ni solicitud, ni re-sellado. Es el caso «Luis completó/corrigió el
  // ticket después de la confirmación».
  if (yaEnviado) {
    return reply({ ok: true, accion: 'ya_enviado', salida, leadId,
      datosRefrescados: true, visitaCopiada: !!upd['Fecha visita'] });
  }

  // 3d) ENCARGO → nace el ticket en `Solicitudes` (la cola de sourcing).
  //     Es el eslabón que conecta la llamada con la otra pantalla: sin esto el
  //     encargo muere en el Kanban de Luis y Roberto nunca se entera de qué hay
  //     que salir a buscar. De acá en adelante el ciclo sigue solo:
  //     Solicitudes → `Buscando` → cron-sourcing avisa a los dueños → cuando la
  //     bici entra, `reactivacion_stock` al cliente.
  //
  //     Guarda contra duplicados: el link `Solicitud` del ticket. Si ya tiene
  //     valor no se crea otro, aunque el endpoint se dispare de nuevo (Luis
  //     corrige algo, la automatización reintenta, etc.).
  let solicitudId = null, avisoSolicitud = 'no_aplica';
  if (salida === 'Encargo de búsqueda' && !linkId(t['Solicitud'])) {
    avisoSolicitud = 'no_configurado';
    const modelo = String(t['Modelo buscado'] || '').trim();
    const notas = [
      `Nace de la llamada de ${t['Nombre'] || 'un lead'}.`,
      t['Ciudad'] ? `Ciudad: ${t['Ciudad']}.` : '',
      t['Estatura (cm)'] ? `Estatura: ${t['Estatura (cm)']} cm.` : '',
      t['Notas'] || '',
    ].filter(Boolean).join(' ');

    const sr = await afetch(api('Solicitudes'), {
      method: 'POST', headers: wH,
      body: JSON.stringify({ typecast: true, fields: {
        // Si Luis no escribió el modelo, el ticket igual nace: es mejor una cola
        // con un ticket incompleto que un encargo perdido. Queda visible que
        // falta el dato y se completa llamando de vuelta.
        'Modelo buscado': modelo || '(por confirmar con el cliente)',
        'Estado': 'Llamada pendiente',
        'Origen': 'Manual',
        'Fecha': today,
        'Lead': [leadId],
        ...(t['Teléfono'] ? { 'Contacto': t['Teléfono'] } : {}),
        ...(notas ? { 'Notas': notas.slice(0, 2000) } : {}),
      } }),
    });
    if (sr.ok) {
      solicitudId = (await sr.json()).id;

      // AVISO AL EQUIPO (pedido de Gabriel 2026-08-03): el encargo nacido del
      // Kanban avisa igual que los del bot (mc-waitlist) — misma plantilla
      // `nueva_solicitud`, mismo flujo y mismos destinatarios. Best-effort: si
      // falla, la Solicitud ya quedó creada y visible en la pantalla 4.
      // Formato unificado del resumen (2026-08-06): modelo primero y el resto
      // entre paréntesis, igual que en `mc-waitlist` y `cron-avisos`. La plantilla
      // `solicitud_busqueda_v2` mete la variable a mitad de oración («Nueva
      // solicitud de búsqueda recibida {{1}}, cambia el estado…»), y con el orden
      // viejo —modelo · talla · precio · contacto— la frase quedaba ilegible.
      const detalleSol = [
        t['Ciudad'] ? `de ${t['Ciudad']}` : '',
        t['Teléfono'] || 'sin teléfono',
        t['Nombre'] || '',
        'nace del Kanban',
      ].filter(Boolean).join(' · ');
      const resumen = `${modelo || 'modelo por confirmar'} (${detalleSol})`;

      // Dentro de la franja sale al tiro; fuera, NO se manda y el sello de la
      // Solicitud queda vacío a propósito, para que `cron-avisos` o el briefing
      // de la mañana lo recojan. La Solicitud ya quedó creada de todos modos.
      const res = await avisar(env, {
        tipo: 'solicitud', flowEnv: 'FLOW_NS_SOLICITUD', campo: 'cf_solicitud_datos', texto: resumen,
      });
      avisoSolicitud = quedaPendiente(res.motivo) ? 'pendiente_de_briefing' : `sin_enviar:${res.motivo}`;
      if (res.puedeSellar) {
        avisoSolicitud = 'enviado';
        await afetch(`${api('Solicitudes')}/${solicitudId}`, {
          method: 'PATCH', headers: wH,
          body: JSON.stringify({ typecast: true, fields: { 'Aviso equipo enviado': now } }),
        });
      }
    }
    // Si falla, no se aborta: el mensaje al cliente igual debe salir. El campo
    // `Solicitud` queda vacío y el próximo disparo lo reintenta.
  }

  // 4) EL MENSAJE. Best-effort: si falla, el lead ya quedó bien escrito y la
  //    respuesta dice por qué — el error NO muere en silencio.
  const MC_TOKEN = env.MANYCHAT_TOKEN || env.MC_TOKEN || '';
  const flowNs = env[cfg.flowEnv] || '';
  const sid = lf['MC subscriber id'] || '';
  let mensaje = 'no_configurado';

  if (!cfg.flowEnv) {
    mensaje = 'sin_mensaje_por_diseño';   // «Sin interés» no manda nada, a propósito
  } else if (!MC_TOKEN || !flowNs) {
    mensaje = `falta_env:${cfg.flowEnv}`;
  } else if (!sid) {
    mensaje = 'sin_subscriber_id';
  } else {
    try {
      // Las plantillas imprimen el modelo con nombres distintos: las de visita
      // usan {cf_bici} y `encargo_recibido` usa {cf_modelo}. Se escriben LOS DOS
      // con el mismo valor para que cada plantilla encuentre el suyo.
      //
      // ⚠️ QUÉ modelo va NO es lo mismo en todas las salidas. En un encargo la
      // persona quiere algo que NO tenemos: nombrar la bici del reel sería
      // escribirle «te avisamos cuando llegue la Levo» cuando pidió una Epic.
      // Por eso el encargo usa `Modelo buscado` y el resto la bici de interés.
      let modelo = '';
      if (salida === 'Encargo de búsqueda') {
        modelo = String(t['Modelo buscado'] || '').trim();
      } else {
        // El link devuelve ids, no nombres → hay que leer la bici para el modelo.
        const biciId = linkId(t['Bici de interés']);
        if (biciId) {
          const br = await afetch(`${api('Inventario')}/${biciId}`, { headers: rH });
          if (br.ok) { const bf = (await br.json()).fields || {}; modelo = bf.Modelo || bf.Etiqueta || ''; }
        }
      }
      const modeloTxt = (modelo || 'la bici que buscas').slice(0, 200);
      await mcSetField(MC_TOKEN, sid, 'cf_bici', modeloTxt);
      await mcSetField(MC_TOKEN, sid, 'cf_modelo', modeloTxt);
      if (cfg.copiaVisita && t['Fecha y hora de visita']) {
        await mcSetField(MC_TOKEN, sid, 'cf_fecha_visita', String(t['Fecha y hora de visita']).slice(0, 60));
      }
      await mcSendFlow(MC_TOKEN, sid, flowNs);
      mensaje = 'enviado';
    } catch (e) {
      mensaje = 'error: ' + String(e && e.message || e).slice(0, 200);
    }
  }

  // 5) Actualizar el TICKET: estado + sello de idempotencia.
  //    El `Estado` se sincroniza SIEMPRE (Luis ya no lo toca, solo arrastra la
  //    tarjeta). El sello solo si el mensaje salió — si falló, queda reintentable.
  // (El `Estado` ya quedó sincronizado en el paso 1b, antes de todos los returns
  // tempranos: acá sólo va el sello y el link a la Solicitud.)
  const updTicket = {};
  if (mensaje === 'enviado' || mensaje === 'sin_mensaje_por_diseño') updTicket['Aviso salida enviado'] = now;
  // El link cierra el circuito y a la vez es la guarda: mientras esté vacío, un
  // reintento vuelve a crear el ticket de búsqueda; una vez escrito, nunca más.
  if (solicitudId) updTicket['Solicitud'] = [solicitudId];
  if (Object.keys(updTicket).length) {
    await afetch(`${api('Llamados')}/${llamadoId}`, {
      method: 'PATCH', headers: wH,
      body: JSON.stringify({ typecast: true, fields: updTicket }),
    });
  }

  return reply({ ok: true, salida, leadId, mensaje,
    permisoPropagado: upd['Opt-in WhatsApp'] === true,
    visitaCopiada: !!upd['Fecha visita'],
    estadoLead: upd['Estado'] || null,
    estadoTicket: estadoEspejo, estadoSincronizado,
    solicitudCreada: solicitudId, avisoSolicitud });
}
// Sólo POST.
