// Cloudflare Pages Function · GET/POST /api/recalcular-embudo
// Recalcula la tabla auxiliar "Embudo" (5 etapas) a partir de Leads.
// Reemplaza la automatización "Run a script" de Airtable (que es de pago / plan Team).
// Lee con AIRTABLE_TOKEN, escribe con AIRTABLE_WRITE_TOKEN (los mismos que ya existen).
//
// Disparo: un botón de Airtable (Open URL) pega a GET y muestra un resumen legible.
// Seguridad opcional: si defines la env RECALC_KEY, exige ?key=ESA_CLAVE.

const BASE_DEFAULT = 'appQUgk8aeD752923';

// Etapas del embudo (en orden) → bandera ACUMULATIVA correspondiente en Leads.
// Los nombres de Etapa deben calzar EXACTO con la tabla Embudo (llevan prefijo de orden).
const STAGES = [
  { etapa: '1. Recibió ficha', flag: 'Llegó a ficha'   },
  { etapa: '2. Agendó',        flag: 'Llegó a agendó'   },
  { etapa: '3. Confirmó',      flag: 'Llegó a confirmó' },
  { etapa: '4. Visitó',        flag: 'Llegó a visitó'   },
  { etapa: '5. Cerró',         flag: 'Llegó a cerró'    },
];

async function recalcular(env) {
  const BASE   = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ   = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;   // lectura
  const WRITE  = env.AIRTABLE_WRITE_TOKEN;                          // escritura
  const LEADS  = env.AIRTABLE_LEADS_TABLE  || 'Leads';
  const EMBUDO = env.AIRTABLE_EMBUDO_TABLE || 'Embudo';
  if (!READ || !WRITE) throw new Error('not_configured (faltan tokens)');
  const api = (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`;

  // 1) Leer TODOS los Leads (paginado), solo las banderas necesarias.
  const qs = STAGES.map(s => `fields%5B%5D=${encodeURIComponent(s.flag)}`).join('&') + '&pageSize=100';
  let records = [], offset = null;
  do {
    const u = `${api(LEADS)}?${qs}${offset ? `&offset=${offset}` : ''}`;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${READ}` } });
    if (!r.ok) throw new Error('read_leads ' + r.status);
    const j = await r.json();
    records = records.concat(j.records || []);
    offset = j.offset || null;
  } while (offset);

  const total  = records.length;
  // Las banderas son fórmulas 1/0; Airtable omite el campo cuando vale 0 → truthy basta.
  const count  = (flag) => records.reduce((n, rec) => n + (rec.fields[flag] ? 1 : 0), 0);
  const counts = STAGES.map(s => count(s.flag));
  const pct    = (num, den) => den ? Math.round((100 * num) / den) : 0;

  // 2) Leer filas de Embudo para mapear Etapa → recordId.
  const er = await fetch(`${api(EMBUDO)}?pageSize=100`, { headers: { Authorization: `Bearer ${READ}` } });
  if (!er.ok) throw new Error('read_embudo ' + er.status);
  const ej = await er.json();
  const idByEtapa = {};
  for (const rec of (ej.records || [])) idByEtapa[rec.fields.Etapa] = rec.id;

  // 3) Escribir conteos y % (un solo PATCH batch).
  const updates = STAGES.map((s, i) => {
    const c    = counts[i];
    const prev = (i === 0) ? total : counts[i - 1];   // 1ra etapa se mide vs total de leads
    return {
      id: idByEtapa[s.etapa],
      fields: {
        'Conteo':       c,
        'Pct global':   pct(c, total),
        'Pct anterior': pct(c, prev),
      },
    };
  }).filter(u => u.id);

  if (updates.length) {
    const wr = await fetch(api(EMBUDO), {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${WRITE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: updates }),
    });
    if (!wr.ok) throw new Error('write_embudo ' + wr.status + ' ' + (await wr.text()));
  }

  return {
    total,
    etapas: STAGES.map((s, i) => ({
      etapa:       s.etapa,
      conteo:      counts[i],
      pctGlobal:   pct(counts[i], total),
      pctAnterior: pct(counts[i], i === 0 ? total : counts[i - 1]),
    })),
  };
}

function keyOk(env, url) {
  const need = env.RECALC_KEY;
  if (!need) return true;                          // sin clave configurada → abierto
  return url.searchParams.get('key') === need;
}

// GET → desde un botón de Airtable (abre la URL). Responde HTML legible.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return new Response('No autorizado', { status: 401 });
  try {
    const s = await recalcular(env);
    const filas = s.etapas.map(e =>
      `<tr><td style="padding:4px 8px">${e.etapa}</td>` +
      `<td style="padding:4px 8px;text-align:right">${e.conteo}</td>` +
      `<td style="padding:4px 8px;text-align:right">${e.pctGlobal}%</td>` +
      `<td style="padding:4px 8px;text-align:right">${e.pctAnterior}%</td></tr>`
    ).join('');
    const html = `<!doctype html><meta charset="utf-8"><title>Embudo actualizado</title>
<body style="font-family:system-ui,Segoe UI,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;color:#1d2433">
<h2>✅ Embudo actualizado</h2>
<p>Total de leads: <b>${s.total}</b>. Ya puedes cerrar esta pestaña y volver al reporte.</p>
<table style="border-collapse:collapse;width:100%;font-size:15px">
<thead><tr style="border-bottom:2px solid #d0d5dd">
<th style="padding:4px 8px;text-align:left">Etapa</th><th style="padding:4px 8px;text-align:right">Conteo</th>
<th style="padding:4px 8px;text-align:right">% total</th><th style="padding:4px 8px;text-align:right">% etapa ant.</th>
</tr></thead><tbody>${filas}</tbody></table></body>`;
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (e) {
    return new Response('Error: ' + (e && e.message || e), { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

// POST → por si más adelante lo dispara un cron/worker. Responde JSON.
export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  try {
    const s = await recalcular(env);
    return new Response(JSON.stringify({ ok: true, ...s }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
}
