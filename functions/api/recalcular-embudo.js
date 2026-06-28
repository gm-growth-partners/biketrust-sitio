// Cloudflare Pages Function · GET/POST /api/recalcular-embudo
// Precalcula la tabla "Metricas" (capa de reporte) desde Leads, por PERÍODO:
//   - Tipo: semana (ISO) · mes · global
//   - Dim:  funnel (5 etapas) · canal · kpi
// Hace UPSERT por la columna "Clave" (la API de Airtable lo soporta → crea
// períodos nuevos solos). Reemplaza la automatización "Run a script" de Airtable
// (que exige plan Team). Lee con AIRTABLE_TOKEN, escribe con AIRTABLE_WRITE_TOKEN.
// Disparo: botón de Airtable (Open URL). Seguridad opcional: env RECALC_KEY → ?key=

const BASE_DEFAULT  = 'appQUgk8aeD752923';
const TABLE_DEFAULT = 'tblj1AgQxvHBUHgeM';   // tabla Metricas por ID (rename-proof)
const LEADS_DEFAULT = 'Leads';

// Etapas del embudo (orden) → bandera ACUMULATIVA en Leads.
const STAGES = [
  { etapa: '1. Recibió ficha', flag: 'Llegó a ficha'   },
  { etapa: '2. Agendó',        flag: 'Llegó a agendó'   },
  { etapa: '3. Confirmó',      flag: 'Llegó a confirmó' },
  { etapa: '4. Visitó',        flag: 'Llegó a visitó'   },
  { etapa: '5. Cerró',         flag: 'Llegó a cerró'    },
];

const pad2 = (n) => String(n).padStart(2, '0');
const pct  = (num, den) => (den ? Math.round((100 * num) / den) : 0);

// Semana ISO en UTC (año-ISO correcto en bordes de año). Recibe Y,M,D numéricos.
function isoWeekLabel(y, m, d) {
  const target = new Date(Date.UTC(y, m - 1, d));
  const dayNr = (target.getUTCDay() + 6) % 7;            // Lun=0 … Dom=6
  target.setUTCDate(target.getUTCDate() - dayNr + 3);     // jueves de esta semana
  const isoYear = target.getUTCFullYear();
  const firstThu = new Date(Date.UTC(isoYear, 0, 4));     // 4-ene siempre es semana 1
  const firstDayNr = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDayNr + 3);
  const week = 1 + Math.round((target - firstThu) / (7 * 86400000));
  return `${isoYear}-W${pad2(week)}`;
}

async function recalcular(env) {
  const BASE  = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ  = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  const WRITE = env.AIRTABLE_WRITE_TOKEN;
  const LEADS = env.AIRTABLE_LEADS_TABLE   || LEADS_DEFAULT;
  const METR  = env.AIRTABLE_METRICAS_TABLE || TABLE_DEFAULT;
  if (!READ || !WRITE) throw new Error('not_configured (faltan tokens)');
  const api = (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`;

  // 1) Leer TODOS los Leads (paginado): banderas + fecha + canal.
  const readFields = [...STAGES.map(s => s.flag), 'Fecha primer contacto', 'Canal origen'];
  const qs = readFields.map(f => `fields%5B%5D=${encodeURIComponent(f)}`).join('&') + '&pageSize=100';
  let leads = [], offset = null;
  do {
    const u = `${api(LEADS)}?${qs}${offset ? `&offset=${offset}` : ''}`;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${READ}` } });
    if (!r.ok) throw new Error('read_leads ' + r.status);
    const j = await r.json();
    leads = leads.concat(j.records || []);
    offset = j.offset || null;
  } while (offset);

  // 2) Acumular por período. clave "Tipo|Periodo" → agregados.
  const P = {};
  const bucket = (tipo, periodo) => {
    const k = `${tipo}|${periodo}`;
    return P[k] || (P[k] = { tipo, periodo, total: 0, stage: [0, 0, 0, 0, 0], canal: {} });
  };
  for (const rec of leads) {
    const f = rec.fields;
    const reached = STAGES.map(s => (f[s.flag] ? 1 : 0));
    const canal = f['Canal origen'] || '(sin canal)';
    const date  = f['Fecha primer contacto'];           // 'YYYY-MM-DD' o undefined

    const targets = [['global', 'Total']];               // global = TODOS los leads
    if (date && /^\d{4}-\d{2}-\d{2}/.test(date)) {
      const [yy, mm, dd] = date.slice(0, 10).split('-').map(Number);
      targets.push(['semana', isoWeekLabel(yy, mm, dd)]);
      targets.push(['mes', date.slice(0, 7)]);           // 'YYYY-MM'
    }
    for (const [tipo, periodo] of targets) {
      const p = bucket(tipo, periodo);
      p.total++;
      for (let i = 0; i < 5; i++) p.stage[i] += reached[i];
      const c = p.canal[canal] || (p.canal[canal] = { leads: 0, agendo: 0 });
      c.leads++; c.agendo += reached[1];                 // índice 1 = agendó
    }
  }

  // 3) Construir filas (funnel + canal + kpi) por período.
  const KPIS = [
    { item: 'Leads totales', orden: 1, count: (p) => p.total },
    { item: 'Agendó',        orden: 2, count: (p) => p.stage[1] },
    { item: 'Confirmó',      orden: 3, count: (p) => p.stage[2] },
    { item: 'Cerró',         orden: 4, count: (p) => p.stage[4] },
    { item: 'Tasa cierre',   orden: 5, pct:   (p) => pct(p.stage[4], p.total) },
  ];
  const rows = [];
  for (const k in P) {
    const p = P[k], total = p.total;
    // funnel
    let prev = total;
    STAGES.forEach((s, i) => {
      const c = p.stage[i];
      rows.push({ Clave: `${p.tipo}|${p.periodo}|funnel|${s.etapa}`, Tipo: p.tipo, Periodo: p.periodo,
        Dim: 'funnel', Item: s.etapa, Orden: i + 1,
        Conteo: c, 'Pct global': pct(c, total), 'Pct anterior': pct(c, prev) });
      prev = c;
    });
    // canal (orden alfabético estable)
    Object.keys(p.canal).sort().forEach((cn, idx) => {
      const cc = p.canal[cn];
      rows.push({ Clave: `${p.tipo}|${p.periodo}|canal|${cn}`, Tipo: p.tipo, Periodo: p.periodo,
        Dim: 'canal', Item: cn, Orden: idx + 1,
        Conteo: cc.leads, 'Pct global': pct(cc.agendo, cc.leads), 'Pct anterior': 0 });
    });
    // kpi
    KPIS.forEach((kp) => {
      rows.push({ Clave: `${p.tipo}|${p.periodo}|kpi|${kp.item}`, Tipo: p.tipo, Periodo: p.periodo,
        Dim: 'kpi', Item: kp.item, Orden: kp.orden,
        Conteo: kp.count ? kp.count(p) : 0, 'Pct global': kp.pct ? kp.pct(p) : 0, 'Pct anterior': 0 });
    });
  }

  // 4) UPSERT por "Clave" en lotes de 10.
  const wH = { Authorization: `Bearer ${WRITE}`, 'Content-Type': 'application/json' };
  for (let i = 0; i < rows.length; i += 10) {
    const batch = rows.slice(i, i + 10).map((fields) => ({ fields }));
    const wr = await fetch(api(METR), {
      method: 'PATCH', headers: wH,
      body: JSON.stringify({ performUpsert: { fieldsToMergeOn: ['Clave'] }, records: batch }),
    });
    if (!wr.ok) throw new Error('upsert ' + wr.status + ' ' + (await wr.text()));
  }

  const g = P['global|Total'] || { total: 0, stage: [0, 0, 0, 0, 0] };
  return {
    totalLeads: g.total,
    rowsWritten: rows.length,
    semanas: Object.values(P).filter((p) => p.tipo === 'semana').length,
    meses: Object.values(P).filter((p) => p.tipo === 'mes').length,
    funnelGlobal: STAGES.map((s, i) => ({ etapa: s.etapa, conteo: g.stage[i], pct: pct(g.stage[i], g.total) })),
  };
}

function keyOk(env, url) {
  const need = env.RECALC_KEY;
  return need ? url.searchParams.get('key') === need : true;
}

// GET → botón de Airtable. Responde HTML legible.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return new Response('No autorizado', { status: 401 });
  try {
    const s = await recalcular(env);
    const filas = s.funnelGlobal.map((e) =>
      `<tr><td style="padding:4px 8px">${e.etapa}</td><td style="padding:4px 8px;text-align:right">${e.conteo}</td><td style="padding:4px 8px;text-align:right">${e.pct}%</td></tr>`
    ).join('');
    const html = `<!doctype html><meta charset="utf-8"><title>Metricas actualizadas</title>
<body style="font-family:system-ui,Segoe UI,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;color:#1d2433">
<h2>✅ Métricas actualizadas</h2>
<p>Leads totales: <b>${s.totalLeads}</b> · semanas: <b>${s.semanas}</b> · meses: <b>${s.meses}</b> · filas escritas: <b>${s.rowsWritten}</b>.</p>
<p>Ya puedes cerrar esta pestaña y volver al reporte.</p>
<h3 style="margin-top:24px">Embudo global</h3>
<table style="border-collapse:collapse;width:100%;font-size:15px">
<thead><tr style="border-bottom:2px solid #d0d5dd"><th style="padding:4px 8px;text-align:left">Etapa</th><th style="padding:4px 8px;text-align:right">Conteo</th><th style="padding:4px 8px;text-align:right">% total</th></tr></thead>
<tbody>${filas}</tbody></table></body>`;
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (e) {
    return new Response('Error: ' + (e && e.message || e), { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

// POST → para cron/worker futuro. Responde JSON.
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
