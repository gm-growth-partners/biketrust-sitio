// Cloudflare Pages Function · POST /api/salida-llamado
// El motor de POST-LLAMADA del embudo V2. Lo dispara una automatización de
// Airtable cuando Luis marca `Salida` en un ticket de `Llamados`.
//
// Cierra de una vez los tres huecos que rompían en silencio:
//   1. PUENTE DEL PERMISO — Luis marca `Permiso WhatsApp` en el TICKET, pero los
//      motores (cron-recordatorios, cron-reenganche) filtran por `Opt-in WhatsApp`
//      en el LEAD. Sin este puente el barrido devuelve 0 sin dar error y nadie
//      recibe confirmación ni recordatorios.
//   2. LA VISITA INVISIBLE — una visita agendada por teléfono no existía para el
//      sistema: nadie escribía `Leads.Fecha visita` ni el `Estado`. Sin eso no
//      salen recordatorios y el tablero muestra «Agendó: 0» aunque Luis agende diez.
//   3. EL MENSAJE AUTOMÁTICO — dispara la plantilla de WhatsApp que corresponde a
//      cada salida, una sola vez (sello de idempotencia `Aviso salida enviado`).
//
// Body: { llamadoId: "recXXX" }   (la automatización manda el id del ticket)
// Lee con AIRTABLE_TOKEN, escribe con AIRTABLE_WRITE_TOKEN. Protegido por MC_KEY.

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
// `estadoTicket` = a qué estado va el TICKET. Lo mantiene este endpoint porque
//                  Luis ya no toca `Estado`: solo arrastra la tarjeta. De ese
//                  cambio depende el sello de `Fecha primera llamada` (la métrica
//                  de velocidad), la cola del briefing y el dedup de mc-llamado.
const SALIDAS = {
  'Visita agendada':     { flowEnv: 'FLOW_NS_CONFIRMACION', estadoLead: 'visita_agendada', estadoTicket: 'Llamado', necesitaPermiso: true,  copiaVisita: true },
  'Coordinación región': { flowEnv: 'FLOW_NS_REGION',       estadoLead: null,              estadoTicket: 'Llamado', necesitaPermiso: true,  copiaVisita: false },
  'Encargo de búsqueda': { flowEnv: 'FLOW_NS_ENCARGO',      estadoLead: null,              estadoTicket: 'Llamado', necesitaPermiso: true,  copiaVisita: false },
  // Excepción deliberada de permiso: no hubo llamada donde pedirlo. Viene del
  // bloque de confirmación del bot («si no te pilla, te deja un WhatsApp»).
  // El ticket VUELVE a la cola: no contestar no cierra nada, es la bandeja de reintentos.
  'No contestado':       { flowEnv: 'FLOW_NS_NO_CONTESTA',  estadoLead: null,              estadoTicket: 'Llamada pendiente', necesitaPermiso: false, copiaVisita: false },
  // Habló y no va a avanzar. Cierra el ticket sin mandar nada, a propósito.
  'Sin interés':         { flowEnv: null,                   estadoLead: null,              estadoTicket: 'Cerrada', necesitaPermiso: false, copiaVisita: false },
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

async function mcSetField(token, sid, name, value) {
  await afetch('https://api.manychat.com/fb/subscriber/setCustomFieldByName', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscriber_id: sid, field_name: name, field_value: value }),
  });
}
async function mcSendFlow(token, sid, flowNs) {
  const r = await afetch('https://api.manychat.com/fb/sending/sendFlow', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscriber_id: sid, flow_ns: flowNs }),
  });
  if (!r.ok) throw new Error(`sendFlow ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

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
  const cfg = SALIDAS[salida];
  if (!cfg) return reply({ ok: true, accion: 'salida_sin_mensaje', salida });

  // 2) IDEMPOTENCIA. Sin esto, cada corrección del ticket dispara otro WhatsApp.
  if (t['Aviso salida enviado']) return reply({ ok: true, accion: 'ya_enviado', salida });

  const leadId = linkId(t['Lead']);
  if (!leadId) return reply({ ok: true, accion: 'sin_lead', salida });

  const lr = await afetch(`${api('Leads')}/${leadId}`, { headers: rH });
  if (!lr.ok) return reply({ error: 'lead_not_found', status: lr.status }, 404);
  const lf = (await lr.json()).fields || {};

  // 3) PROPAGAR AL LEAD lo que Luis registró en el ticket.
  const upd = { 'Fecha última interacción': now };

  //   3a) El puente del permiso: del ticket a la persona.
  if (t['Permiso WhatsApp'] === true && !lf['Opt-in WhatsApp']) {
    upd['Opt-in WhatsApp'] = true;
    upd['Fecha opt-in'] = today;
  }

  //   3b) La visita agendada por teléfono, para que el motor de recordatorios la vea.
  //       Al reagendar se limpian los sellos, igual que hace mc-agenda, para que
  //       el ciclo de recordatorios vuelva a correr sobre la fecha nueva.
  if (cfg.copiaVisita && t['Fecha y hora de visita']) {
    upd['Fecha visita'] = t['Fecha y hora de visita'];
    upd['Recordatorio 48h'] = null;
    upd['Recordatorio 8am'] = null;
    upd['Recordatorio 2h'] = null;

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
  let solicitudId = null;
  if (salida === 'Encargo de búsqueda' && !linkId(t['Solicitud'])) {
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
  } else if (cfg.necesitaPermiso && t['Permiso WhatsApp'] !== true) {
    mensaje = 'sin_permiso';
  } else if (!MC_TOKEN || !flowNs) {
    mensaje = `falta_env:${cfg.flowEnv}`;
  } else if (!sid) {
    mensaje = 'sin_subscriber_id';
  } else {
    try {
      // La plantilla imprime cf_bici; se puebla antes de disparar el flujo.
      // El link devuelve ids, no nombres → hay que leer la bici para el modelo.
      let biciNombre = '';
      const biciId = linkId(t['Bici de interés']);
      if (biciId) {
        const br = await afetch(`${api('Inventario')}/${biciId}`, { headers: rH });
        if (br.ok) { const bf = (await br.json()).fields || {}; biciNombre = bf.Modelo || bf.Etiqueta || ''; }
      }
      await mcSetField(MC_TOKEN, sid, 'cf_bici', (biciNombre || 'tu bici').slice(0, 200));
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
  const updTicket = {};
  if (cfg.estadoTicket && t['Estado'] !== cfg.estadoTicket) updTicket['Estado'] = cfg.estadoTicket;
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
    estadoTicket: updTicket['Estado'] || null,
    solicitudCreada: solicitudId });
}
// Sólo POST.
