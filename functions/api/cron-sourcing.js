// Cloudflare Pages Function · GET /api/cron-sourcing
// Avisa a Roberto y Alfonso cuando un encargo de búsqueda pasa a `Buscando`.
// Pedido de Roberto (reunión 2026-07-27): hoy el sourcing no tiene trazabilidad
// — Luis mueve el ticket y los dueños no se enteran de qué hay que salir a buscar.
//
// Es un BARRIDO, no una automatización de Airtable: lo dispara el mismo worker
// cron que ya corre cada 15 min. Así no consume automation runs de Airtable
// (que son limitadas y se pagan) y el sello de idempotencia vive en la tabla.
//
// Idempotente: solo toma Solicitudes con `Estado = Buscando` y `Aviso buscando`
// vacío, y sella al enviar. Re-llamarlo cada 15 min es seguro.
//
// Env: AIRTABLE_TOKEN · AIRTABLE_WRITE_TOKEN · MC_TOKEN · FLOW_NS_BUSCANDO ·
//      AVISO_SOURCING_SIDS (ids ManyChat separados por coma; fallback BRIEFING_SIDS).
// Protegido por CRON_KEY (?key=), igual que los otros cron-*.

import { avisarStaff, sidsAviso } from '../../lib/avisos.js';

const JSONH = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSONH });

const BASE_DEFAULT = 'appQUgk8aeD752923';
const MAX_POR_CORRIDA = 10; // cota de seguridad: nunca inundar el WhatsApp del staff

async function afetch(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, opts);
    if (r.status !== 429 || i >= tries - 1) return r;
    await new Promise(res => setTimeout(res, 1200 * (i + 1)));
  }
}

// Los helpers de ManyChat viven en `lib/avisos.js` (dentro de `avisarStaff`).

const clp = (n) => (n == null || n === '') ? '' : '$' + Number(n).toLocaleString('es-CL');

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const need = env.CRON_KEY;
  if (need && url.searchParams.get('key') !== need) return reply({ error: 'unauthorized' }, 401);

  const BASE  = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ  = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  const WRITE = env.AIRTABLE_WRITE_TOKEN;
  if (!READ || !WRITE) return reply({ error: 'not_configured' }, 503);
  const api = (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`;
  const rH = { Authorization: `Bearer ${READ}` };
  const wH = { Authorization: `Bearer ${WRITE}`, 'Content-Type': 'application/json' };
  const now = new Date().toISOString();

  const MC_TOKEN = env.MANYCHAT_TOKEN || env.MC_TOKEN || '';
  const FLOW = env.FLOW_NS_BUSCANDO || '';
  // ⚠️ SIN fallback a `BRIEFING_SIDS`. Lo tenía, y era una trampa: sumar a alguien
  // al briefing lo suscribía de rebote a los avisos de sourcing. Ahora `sidsAviso`
  // resuelve la cadena de 'sourcing', que a propósito NO cae a nadie: si no hay
  // destinatarios declarados, el aviso no sale. Mejor silencio que sonarle a quien
  // no corresponde.
  const SIDS = sidsAviso(env, 'sourcing');

  // 1) Encargos que pasaron a Buscando y todavía no se avisaron.
  const f = `AND({Estado}='Buscando', {Aviso buscando}=BLANK())`;
  const su = `${api('Solicitudes')}?pageSize=${MAX_POR_CORRIDA}&filterByFormula=${encodeURIComponent(f)}`;
  const sr = await afetch(su, { headers: rH });
  if (!sr.ok) return reply({ error: 'airtable_read', status: sr.status, detail: await sr.text() }, 502);
  const pendientes = (await sr.json()).records || [];
  if (!pendientes.length) return reply({ ok: true, pendientes: 0 });

  if (!MC_TOKEN || !FLOW || !SIDS.length) {
    return reply({ ok: true, pendientes: pendientes.length, aviso: 'no_configurado',
      falta: [!MC_TOKEN && 'MC_TOKEN', !FLOW && 'FLOW_NS_BUSCANDO', !SIDS.length && 'AVISO_SOURCING_SIDS'].filter(Boolean) });
  }

  // 2) Un aviso por encargo, a cada destinatario.
  const enviados = [], errores = [];
  for (const rec of pendientes) {
    const s = rec.fields || {};
    // Formato unificado (2026-08-06): modelo primero, resto entre paréntesis.
    // De paso se arregla un bug cosmético que llevaba meses: la línea del contacto
    // anteponía `· ` Y ADEMÁS el `join(' · ')` metía el suyo, así que cada aviso
    // con teléfono salía con un `· ·` doble.
    const detalle = [
      s['Talla'] ? `talla ${s['Talla']}` : '',
      s['Presupuesto'] != null ? `hasta ${clp(s['Presupuesto'])}` : '',
      s['Motorización'] || '',
      s['Disciplina'] || '',
      s['Contacto'] || 'sin teléfono',
    ].filter(Boolean).join(' · ');
    const resumen = `${s['Modelo buscado'] || 'modelo sin especificar'} (${detalle})`;

    // `avisarStaff` captura el error POR DESTINATARIO. Antes el `try` envolvía el
    // bucle entero: si el segundo sid fallaba, el primero —que ya había recibido—
    // se contaba como fallido, no se sellaba, y el próximo tick le mandaba de
    // nuevo. Con un destinatario roto de forma permanente eso es un reenvío cada
    // 15 minutos, para siempre.
    const res = await avisarStaff(env, {
      cual: 'sourcing', flowEnv: 'FLOW_NS_BUSCANDO', campo: 'cf_solicitud_datos', texto: resumen,
    });

    if (res.enviados > 0) {
      // Sellar SOLO si salió a alguien, para que un fallo se reintente solo.
      await afetch(`${api('Solicitudes')}/${rec.id}`, {
        method: 'PATCH', headers: wH,
        body: JSON.stringify({ fields: { 'Aviso buscando': now } }),
      });
      enviados.push(rec.id);
    } else {
      errores.push({ id: rec.id, motivo: res.motivo, error: (res.errores || []).join(' | ').slice(0, 160), falta: res.falta });
    }
  }

  // `errores` viaja en la respuesta para que el log del worker lo muestre: los
  // fallos de envío NO deben morir en silencio (es el modo de falla más caro).
  return reply({ ok: true, pendientes: pendientes.length, enviados: enviados.length, errores });
}
