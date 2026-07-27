// Cloudflare Pages Function · POST /api/mc-match
// Corazón de la Puerta 2 (DM). ManyChat, dentro de la ventana de 24h del DM de
// Instagram, manda acá o bien un MODELO en texto libre (rama "sé cuál quiero")
// o los CRITERIOS del quiz (motorización · disciplina · presupuesto · talla,
// rama "ayúdame a elegir"). El endpoint consulta el Inventario en Airtable y
// devuelve la bici Disponible que hace match — o una alternativa similar +
// waitlist si no hay — y de paso deja registrado el lead + el Interés.
//
//   Modo A · modelo específico:  body { modelo: "<texto>" }
//     · 1 Disponible calza      → hero (ficha + agenda)
//     · varias Disponibles      → opciones[] (ManyChat desambigua; sin Interés aún)
//     · solo vendida/reservada  → no_match + alternativa (misma disciplina) + waitlist
//     · nada calza              → no_match + waitlist (guarda "Modelo buscado")
//   Modo B · quiz (criterios):   body { motorizacion, disciplina, presupuesto, talla }
//     · puntúa las Disponibles  → hero (protagonista) + alternativa
//     · inventario vacío        → no_match + waitlist
//
//   - Lead    → resuelto por lead/handle/subscriber_id; si no existe y hay handle,
//               se crea (contrato mc-lead: @handle, Canal, Estado, fechas).
//               Estado avanza a match_entregado / no_match (guarda de no-regresión).
//   - Interés → Match (Es hero, link Bici, Crit·… del quiz) cuando hay UNA bici;
//               No-match (+ "Modelo buscado") en waitlist. En multi-opción NO crea
//               Interés (se crea al agendar, vía mc-agenda). No duplica.
//
// El slug de la ficha se reconstruye igual que build.mjs: slug(`${modelo}-${talla}`)
// → /ficha/<slug>. Sin colisiones modelo+talla en el catálogo actual reproduce las
// URLs reales; un duplicado exacto futuro necesitaría el sufijo -N del build.
//
// Lee con AIRTABLE_TOKEN, escribe con AIRTABLE_WRITE_TOKEN. Protegido por env
// MC_KEY (?key=). Sin env → abierto (mismo criterio que los otros puentes ManyChat).

const JSONH = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSONH });

const BASE_DEFAULT = 'appQUgk8aeD752923';
const SITE_DEFAULT = 'https://biketrust-sitio.pages.dev';

// Orden de la máquina de estados (idéntico a mc-evento/mc-agenda). 99 = terminal.
const RANGO = {
  nuevo: 0,
  ficha_entregada: 1, quiz_iniciado: 1,
  quiz_abandonado: 2, match_entregado: 2, no_match: 2,
  visita_agendada: 3,
  visita_confirmada: 4,
  no_show: 5, 'visitó': 5,
  'cerró': 6,
  muerto: 99, descartado: 99,
};

async function afetch(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, opts);
    if (r.status !== 429 || i >= tries - 1) return r;
    await new Promise(res => setTimeout(res, 1200 * (i + 1)));
  }
}

function keyOk(env, url) {
  const need = env.MC_KEY;
  return need ? url.searchParams.get('key') === need : true;
}

const linkIds = (v) => (Array.isArray(v) ? v : []).map(x => (typeof x === 'string' ? x : x.id)).filter(Boolean);

// slug idéntico al de build.mjs (line 28): minúsculas, sin acentos, no-alfanum → '-'.
const slugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Normaliza texto para comparar (búsqueda de modelo / igualdad de select).
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

const clp = (n) => (n == null || n === '') ? null : '$' + Number(n).toLocaleString('es-CL');

// Presupuesto tolerante: "$3.000.000", "3000000", "3 millones" → número (techo).
function parsePresupuesto(v) {
  if (v == null || v === '') return null;
  const s = String(v).toLowerCase();
  const digits = s.replace(/[^0-9]/g, '');
  if (!digits) return null;
  let n = parseInt(digits, 10);
  if (/mill/.test(s) && n < 1000) n = n * 1000000; // "3 millones" → 3.000.000
  return n;
}

// Estatura tolerante: "1,75", "1.75", "175", "175 cm" → metros. Fuera de rango
// humano razonable (o merge tag sin resolver) → null.
function parseAltura(v) {
  if (v == null || v === '' || String(v).includes('{{')) return null;
  const m = /\d+(?:[.,]\d+)?/.exec(String(v));
  if (!m) return null;
  let n = parseFloat(m[0].replace(',', '.'));
  if (n > 3) n = n / 100; // vino en centímetros
  return (n >= 1.2 && n <= 2.2) ? n : null;
}

// "1,68 a 1,78 m" / "1.65 - 1.78" / "165-178 cm" → [min, max] en metros.
function parseRangoAltura(s) {
  const nums = String(s || '').match(/\d+(?:[.,]\d+)?/g);
  if (!nums || nums.length < 2) return null;
  const vals = nums.slice(0, 2).map(x => {
    let n = parseFloat(x.replace(',', '.'));
    if (n > 3) n = n / 100;
    return n;
  }).sort((a, b) => a - b);
  return (vals[0] >= 1.2 && vals[1] <= 2.2) ? vals : null;
}

const cfg = (env) => {
  const BASE = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  const WRITE = env.AIRTABLE_WRITE_TOKEN;
  return {
    BASE, READ, WRITE,
    SITE: (env.SITE_URL || SITE_DEFAULT).replace(/\/+$/, ''),
    LEADS: env.AIRTABLE_LEADS_TABLE || 'Leads',
    INTER: env.AIRTABLE_INTERESES_TABLE || 'Intereses',
    INV: env.AIRTABLE_INVENTARIO_TABLE || 'Inventario',
    api: (t) => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}`,
    rH: { Authorization: `Bearer ${READ}` },
    wH: { Authorization: `Bearer ${WRITE}`, 'Content-Type': 'application/json' },
  };
};

// Vista pública de una bici (lo que ManyChat pinta en el DM).
function biciView(C, b) {
  const f = b.fields || {};
  const modelo = f.Modelo || f.Etiqueta || '';
  const talla = f.Talla || '';
  const slug = slugify(`${modelo}-${talla}`);
  const fotos = f['Fotos galería'];
  const foto = Array.isArray(fotos) && fotos[0]
    ? (fotos[0].thumbnails?.large?.url || fotos[0].url) : null;
  return {
    biciId: b.id,
    modelo,
    etiqueta: f.Etiqueta || modelo,
    marca: f.Marca || '',
    talla: talla || null,
    anio: f['Año'] || null,
    precio: f.Precio ?? null,
    precioCLP: clp(f.Precio),
    disciplina: f.Disciplina || null,
    motorizacion: f['Motorización'] || null,
    rangoAltura: f['Rango altura'] || null,
    foto,
    fichaUrl: `${C.SITE}/ficha/${slug}`,
  };
}

// Puntúa una bici contra criterios (disciplina/motorización/presupuesto/altura/talla).
// Todos blandos: nada bloquea ("no sé mi talla → se confirma en la visita").
function scoreBici(f, crit) {
  let score = 0;
  if (crit.disciplina && norm(f.Disciplina) === norm(crit.disciplina)) score += 40;
  if (crit.motorizacion && norm(f['Motorización']) === norm(crit.motorizacion)) score += 30;
  if (crit.presupuesto != null && f.Precio != null) {
    if (f.Precio <= crit.presupuesto) score += 20 - Math.min(15, (crit.presupuesto - f.Precio) / 1e6); // dentro: premia lo cercano al techo
    else score -= Math.min(25, (f.Precio - crit.presupuesto) / 1e6 * 5); // sobre presupuesto: penaliza
  }
  // La TALLA se asigna por estatura: si la bici declara `Rango altura` y el
  // cliente dio su altura, dentro del rango suma y fuera penaliza (con 2 cm de
  // tolerancia). Sin rango declarado → neutro (no castiga fichas incompletas).
  if (crit.altura != null) {
    const rango = parseRangoAltura(f['Rango altura']);
    if (rango) score += (crit.altura >= rango[0] - 0.02 && crit.altura <= rango[1] + 0.02) ? 12 : -8;
  }
  if (crit.talla && norm(f.Talla) === norm(crit.talla)) score += 10;
  return score;
}

// Devuelve las Disponibles ordenadas por score desc (excluye un id opcional).
function rankDisponibles(disponibles, crit, excludeId) {
  return disponibles
    .filter(b => b.id !== excludeId)
    .map(b => ({ b, s: scoreBici(b.fields, crit) }))
    .sort((x, y) => y.s - x.s);
}

// ───────────────────────────────────────────────────────────────────────────
export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return reply({ error: 'unauthorized' }, 401);

  let data;
  try { data = await request.json(); }
  catch { return reply({ error: 'bad_json' }, 400); }

  const handle = data?.handle ? String(data.handle).trim().replace(/^@/, '') : '';
  const leadIn = data?.lead ? String(data.lead).trim() : '';
  const subId = data?.subscriber_id ? String(data.subscriber_id).trim() : '';
  const modelo = data?.modelo ? String(data.modelo).trim() : '';
  const crit = {
    motorizacion: data?.motorizacion ? String(data.motorizacion).trim() : '',
    disciplina: data?.disciplina ? String(data.disciplina).trim() : '',
    presupuesto: parsePresupuesto(data?.presupuesto),
    altura: parseAltura(data?.altura),
    talla: data?.talla ? String(data.talla).trim() : '',
  };
  const esQuiz = !modelo && !!(crit.motorizacion || crit.disciplina || crit.presupuesto != null || crit.altura != null || crit.talla);
  const origen = String(data?.origen || 'Puerta 2 (quiz)').trim();
  const canal = String(data?.canal || (esQuiz ? 'Quiz' : 'DM IG')).trim();

  if (!modelo && !esQuiz) return reply({ error: 'missing_fields (modelo o criterios del quiz)' }, 422);
  if (!leadIn && !handle && !subId) return reply({ error: 'missing_fields (lead, handle o subscriber_id)' }, 422);

  const C = cfg(env);
  if (!C.READ || !C.WRITE) return reply({ error: 'not_configured' }, 503);
  const now = new Date().toISOString();
  const today = new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10); // Chile UTC-4

  // 1) Resolver el Lead: id directo → @handle IG → MC subscriber id.
  const findLead = async (formula) => {
    const u = `${C.api(C.LEADS)}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;
    const rr = await afetch(u, { headers: C.rH });
    if (!rr.ok) return { err: reply({ error: 'airtable_read', status: rr.status, detail: await rr.text() }, 502) };
    return { id: (await rr.json()).records?.[0]?.id || null };
  };
  let leadId = leadIn, leadCreado = false;
  if (!leadId && handle) {
    const r = await findLead(`LOWER({@handle IG})='${handle.toLowerCase().replace(/'/g, "\\'")}'`);
    if (r.err) return r.err;
    leadId = r.id;
  }
  if (!leadId && subId) {
    const r = await findLead(`{MC subscriber id}='${subId.replace(/'/g, "\\'")}'`);
    if (r.err) return r.err;
    leadId = r.id;
  }

  // 1b) No existe: si hay handle, nace acá con el contrato de mc-lead. Sin handle
  //     (solo subscriber_id) no hay identidad estable de dedup → 404.
  let estadoActual = 'nuevo';
  if (!leadId) {
    if (!handle) return reply({ error: 'lead_not_found (llama /api/mc-lead primero)' }, 404);
    const cr = await afetch(C.api(C.LEADS), {
      method: 'POST', headers: C.wH,
      body: JSON.stringify({ typecast: true, fields: {
        '@handle IG': handle,
        'Canal origen': canal,
        'Estado': 'nuevo',
        'Fecha primer contacto': now,
        'Fecha última interacción': now,
        ...(subId ? { 'MC subscriber id': subId } : {}),
      } }),
    });
    if (!cr.ok) return reply({ error: 'airtable_lead_create', status: cr.status, detail: await cr.text() }, 502);
    leadId = (await cr.json()).id; leadCreado = true;
  } else {
    // Leer estado actual (guarda de no-regresión) + cachear subscriber_id si llegó.
    const lr = await afetch(`${C.api(C.LEADS)}/${leadId}`, { headers: C.rH });
    if (!lr.ok) return reply({ error: 'lead_not_found', status: lr.status }, 404);
    estadoActual = (await lr.json()).fields?.Estado || 'nuevo';
  }

  // 2) Traer el Inventario (14 unidades premium → una página basta; cap 100).
  const invU = `${C.api(C.INV)}?pageSize=100`;
  const ir = await afetch(invU, { headers: C.rH });
  if (!ir.ok) return reply({ error: 'airtable_inventario', status: ir.status, detail: await ir.text() }, 502);
  const inventario = (await ir.json()).records || [];
  const disponibles = inventario.filter(b => b.fields?.Estado === 'Disponible');

  // 3) MATCH.
  let hero = null, alternativa = null, opciones = [], otras = [], otrasTexto = '', waitlist = false, modeloBuscado = '';

  if (modelo) {
    // ── Modo A · modelo en texto libre ──────────────────────────────────────
    // Matching TOLERANTE a typos (2026-07-18): además de substring, cada token
    // de la búsqueda calza contra las palabras del modelo por prefijo o por
    // distancia de edición ("cruz" → "crux", "quenevo" → "kenevo"). Tolerancia
    // según largo del token: ≤3 exacto · 4-6 → 1 typo · ≥7 → 2 typos.
    const lev = (a, b, max) => {
      if (Math.abs(a.length - b.length) > max) return max + 1;
      let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
      for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
          cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
          if (cur[j] < rowMin) rowMin = cur[j];
        }
        if (rowMin > max) return max + 1;
        prev = cur;
      }
      return prev[b.length];
    };
    const tol = (t) => (t.length >= 7 ? 2 : t.length >= 3 ? 1 : 0);
    // Calidad del calce token↔palabra: exacto (1) > substring (0.9) > el token
    // contiene la palabra (0.8, palabras ≥4 para no calzar con "evo"/"sl") >
    // typo dentro de la tolerancia (0.7). El ranking usa la suma → un calce
    // exacto le gana a uno con typo ("quenevo" prefiere Kenevo sobre Epic EVO).
    const tokScore = (t, words) => {
      let best = 0;
      for (const w of words) {
        let s = 0;
        if (w === t) s = 1;
        else if (w.includes(t)) s = t.length >= 3 ? 0.9 : 0.6;
        else if (t.includes(w) && w.length >= 4) s = 0.8;
        else if (lev(t, w, tol(t)) <= tol(t)) s = 0.7;
        if (s > best) best = s;
      }
      return best;
    };
    const q = norm(modelo);
    const qTokens = q.split(' ').filter(Boolean);
    // Bigramas: pares de palabras adyacentes pegadas ("s works" → "sworks").
    // El normalizador parte "S-Works" en dos palabras, así que un cliente que
    // escribe "sworks" (o "swork" con typo) no calzaba con ninguna. Caso real:
    // "Levo sl swork" → No-match con la Levo SL S-Works Disponible (2026-07-26).
    const bigrams = (ws) => ws.slice(0, -1).map((w, i) => w + ws[i + 1]);
    const matches = (records) => records
      .map(b => {
        const txt = norm(`${b.fields?.Marca || ''} ${b.fields?.Modelo || ''}`);
        const ws = txt.split(' ').filter(Boolean);
        const words = ws.concat(bigrams(ws));
        const sub = txt.includes(q);
        const allTok = qTokens.every(t => tokScore(t, words) > 0);
        const cov = qTokens.reduce((a, t) => a + tokScore(t, words), 0);
        return { b, hit: sub || allTok, sub, cov };
      })
      .filter(x => x.hit)
      .sort((a, b) => (b.sub - a.sub) || (b.cov - a.cov));

    const dispMatch = matches(disponibles);
    if (dispMatch.length >= 1) {
      // Siempre hay una PRINCIPAL (la mejor coincidencia). Si hay más, van como
      // `otras` + una línea de texto lista para el DM — así ManyChat no necesita
      // botones dinámicos: muestra la principal (ficha+agenda) + el texto de las otras.
      opciones = dispMatch.slice(0, 3).map(x => biciView(C, x.b)); // completo (referencia API)
      hero = opciones[0];
      if (dispMatch.length > 1) {
        otras = opciones.slice(1);
        otrasTexto = 'También tengo: ' + otras.map(o =>
          `${o.modelo}${o.talla ? ' (talla ' + o.talla + ')' : ''} · ${o.precioCLP}`).join(' · ') +
          '. Escríbeme el nombre exacto si prefieres una de esas.';
      }
    } else {
      // No hay Disponible. ¿Existe pero vendida/reservada? → alternativa por su disciplina.
      waitlist = true; modeloBuscado = modelo;
      const vendidas = matches(inventario.filter(b => b.fields?.Estado !== 'Disponible'));
      if (vendidas.length) {
        const ref = vendidas[0].b.fields;
        const ranked = rankDisponibles(disponibles, {
          disciplina: ref.Disciplina, motorizacion: ref['Motorización'],
          presupuesto: ref.Precio, talla: ref.Talla,
        });
        if (ranked[0] && ranked[0].s > 0) alternativa = biciView(C, ranked[0].b);
      }
    }
  } else {
    // ── Modo B · quiz por criterios ─────────────────────────────────────────
    if (disponibles.length) {
      const ranked = rankDisponibles(disponibles, crit);
      hero = biciView(C, ranked[0].b);
      if (ranked[1] && ranked[1].s > 0) alternativa = biciView(C, ranked[1].b);
    } else {
      waitlist = true;
      modeloBuscado = [crit.motorizacion, crit.disciplina, crit.talla, crit.presupuesto ? clp(crit.presupuesto) : '']
        .filter(Boolean).join(' · ');
    }
  }

  const match = !!hero;
  const nuevoEstado = match ? 'match_entregado' : 'no_match';

  // 4) Avanzar el Estado (guarda de no-regresión).
  let estadoAplicado = false;
  const fieldsLead = { 'Fecha última interacción': now };
  if (subId && !leadCreado) fieldsLead['MC subscriber id'] = subId;
  if (nuevoEstado) {
    const rangoNuevo = RANGO[nuevoEstado] ?? 999;
    const rangoActual = estadoActual in RANGO ? RANGO[estadoActual] : 0;
    if (rangoNuevo >= rangoActual) { fieldsLead['Estado'] = nuevoEstado; estadoAplicado = true; }
  }
  const lp = await afetch(`${C.api(C.LEADS)}/${leadId}`, {
    method: 'PATCH', headers: C.wH,
    body: JSON.stringify({ typecast: true, fields: fieldsLead }),
  });
  if (!lp.ok) return reply({ error: 'airtable_lead_update', status: lp.status, detail: await lp.text() }, 502);

  // 5) Interés: Match (hay UNA bici) o No-match/waitlist. En multi-opción no se
  //    crea (se creará al agendar la elegida, vía mc-agenda — no duplica).
  const critFields = esQuiz ? {
    ...(crit.motorizacion ? { 'Crit · motorización': crit.motorizacion } : {}),
    ...(crit.disciplina ? { 'Crit · disciplina': crit.disciplina } : {}),
    ...(crit.presupuesto != null ? { 'Crit · presupuesto': crit.presupuesto } : {}),
    ...(crit.altura != null ? { 'Crit · altura': String(data?.altura).trim().slice(0, 20) } : {}),
    ...(crit.talla ? { 'Crit · talla': crit.talla } : {}),
  } : {};

  let interesId = null, interesCreado = false;
  if (match) {
    const cr = await afetch(C.api(C.INTER), {
      method: 'POST', headers: C.wH,
      body: JSON.stringify({ typecast: true, fields: {
        'Lead': [leadId],
        'Bici': [hero.biciId],
        'Origen': origen,
        'Resultado': 'Match',
        'Es hero': true,
        'Fecha': today,
        ...critFields,
      } }),
    });
    if (!cr.ok) return reply({ error: 'airtable_interes_create', status: cr.status, detail: await cr.text() }, 502);
    interesId = (await cr.json()).id; interesCreado = true;
  } else if (waitlist) {
    const cr = await afetch(C.api(C.INTER), {
      method: 'POST', headers: C.wH,
      body: JSON.stringify({ typecast: true, fields: {
        'Lead': [leadId],
        'Origen': origen,
        'Resultado': 'No-match',
        'Modelo buscado': modeloBuscado.slice(0, 200),
        'Fecha': today,
        ...critFields,
      } }),
    });
    if (!cr.ok) return reply({ error: 'airtable_interes_create', status: cr.status, detail: await cr.text() }, 502);
    interesId = (await cr.json()).id; interesCreado = true;
  }

  // Campos APLANADOS (primer nivel) para que el mapeo de respuesta en ManyChat
  // sea trivial: valores simples, sin rutas anidadas (`$.hero.modelo`) que la UI
  // no siempre lee bien. Vacíos = '' (ManyChat los trata como campo en blanco).
  const H = hero || {}, A = alternativa || {};
  const flat = {
    heroModelo: H.modelo || '',
    heroPrecio: H.precioCLP || '',
    heroTalla: H.talla || '',
    heroFicha: H.fichaUrl || '',
    heroBici: H.biciId || '',
    heroFoto: H.foto || '',
    altModelo: A.modelo || '',
    altPrecio: A.precioCLP || '',
    altFicha: A.fichaUrl || '',
    altBici: A.biciId || '',
  };

  return reply({
    ok: true,
    mode: modelo ? 'modelo' : 'quiz',
    match, waitlist,
    ...flat,                          // ← usar estos en ManyChat (planos)
    otrasTexto: otrasTexto || '',     // línea lista para el DM cuando hay varias
    modeloBuscado: modeloBuscado || null,
    hero, alternativa, opciones, otras, // objetos completos (referencia/API)
    leadId, leadCreado,
    interesId, interesCreado,
    estadoActual: fieldsLead['Estado'] || estadoActual, estadoAplicado,
  });
}
// Sólo POST. Pages responde 405 automáticamente a otros métodos en esta ruta.
