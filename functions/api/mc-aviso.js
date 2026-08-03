// Cloudflare Pages Function · POST /api/mc-aviso
// Aviso GENÉRICO al equipo por WhatsApp (plantilla `aviso_equipo`). Lo llama
// ManyChat cuando una conversación necesita una persona: el enrutador no
// clasificó (AB-2 del anti-bucle), alguien pidió la respuesta técnica por chat
// (T-2), o cualquier caso futuro de «humano requerido». Complementa la
// notificación nativa de ManyChat (push/email) con un WhatsApp real.
//
//   Body: { handle?, motivo?, mensaje? } — todo opcional; se arma el resumen
//   que la plantilla imprime en {{1}} vía el custom field `cf_aviso_datos`.
//
//   Envs: MANYCHAT_TOKEN · FLOW_NS_AVISO_EQUIPO (flujo envoltorio de 1 nodo
//   con la plantilla `aviso_equipo`) · AVISO_EQUIPO_SIDS (ids separados por
//   coma; fallback AVISO_LLAMADO_SIDS → LUIS_SUBSCRIBER_ID).
//
// ⚠️ SIN filtro de horario, a propósito: este aviso es raro y significa «hay
// un lead varado esperando a una persona» — perderlo de noche es peor que
// sonar. (Los demás avisos sí respetan AVISO_HORARIOS; este no.)
//
// Protegido por MC_KEY (?key=). Mientras falten las envs devuelve
// `no_configurado` sin romper el flujo que lo llama.

const JSONH = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSONH });

async function afetch(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, opts);
    if (r.status !== 429 || i >= tries - 1) return r;
    await new Promise(res => setTimeout(res, 1200 * (i + 1)));
  }
}

const keyOk = (env, url) => { const need = env.MC_KEY; return need ? url.searchParams.get('key') === need : true; };

// Texto limpio: recorta y descarta merge tags sin resolver ({{cuf_…}}).
const clean = (v, max = 400) => {
  const s = String(v ?? '').trim();
  if (!s || s.includes('{{')) return '';
  return s.slice(0, max);
};

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return reply({ error: 'unauthorized' }, 401);

  let data;
  try { data = await request.json(); } catch { return reply({ error: 'bad_json' }, 400); }

  const handle = clean(data?.handle, 60).replace(/^@/, '');
  const motivo = clean(data?.motivo, 120);
  const mensaje = clean(data?.mensaje, 500);

  const MC_TOKEN = env.MANYCHAT_TOKEN || '';
  const FLOW = env.FLOW_NS_AVISO_EQUIPO || '';
  const SIDS = String(env.AVISO_EQUIPO_SIDS || env.AVISO_LLAMADO_SIDS || env.LUIS_SUBSCRIBER_ID || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  if (!MC_TOKEN || !FLOW || !SIDS.length) {
    return reply({ ok: true, aviso: 'no_configurado',
      falta: [!MC_TOKEN && 'MANYCHAT_TOKEN', !FLOW && 'FLOW_NS_AVISO_EQUIPO', !SIDS.length && 'AVISO_EQUIPO_SIDS'].filter(Boolean) });
  }

  const resumen = [
    handle ? `IG @${handle}` : 'contacto sin handle',
    motivo || 'necesita a una persona',
    mensaje ? `dijo: «${mensaje}»` : '',
  ].filter(Boolean).join(' · ');

  let enviados = 0, errores = [];
  for (const sid of SIDS) {
    try {
      await afetch('https://api.manychat.com/fb/subscriber/setCustomFieldByName', {
        method: 'POST',
        headers: { Authorization: `Bearer ${MC_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriber_id: sid, field_name: 'cf_aviso_datos', field_value: resumen.slice(0, 900) }),
      });
      const r = await afetch('https://api.manychat.com/fb/sending/sendFlow', {
        method: 'POST',
        headers: { Authorization: `Bearer ${MC_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriber_id: sid, flow_ns: FLOW }),
      });
      if (!r.ok) throw new Error(`sendFlow ${r.status}`);
      enviados++;
    } catch (e) {
      errores.push(`${sid}: ${String(e && e.message || e).slice(0, 120)}`);
    }
  }

  return reply({ ok: true, aviso: enviados ? 'enviado' : 'error', enviados, ...(errores.length ? { errores } : {}) });
}
// Sólo POST. Pages responde 405 automáticamente a otros métodos en esta ruta.
