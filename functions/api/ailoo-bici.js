// Cloudflare Pages Function · POST /api/ailoo-bici
// PUENTE AILOO → INVENTARIO. Lo llama el ERP de Bike Trust (Ailoo) cada vez que
// una bicicleta se crea o se modifica en su formulario de producto. Reemplaza la
// digitación doble: la bici nace en Airtable con todos los campos de la ficha ya
// mapeados, y el sitio se reconstruye solo.
//
// El contrato con Ailoo está escrito en `…/2. Fragua/Requerimiento_tecnico_Ailoo.docx`
// (secciones 2 y 4) y resumido en `docs/AILOO_INTEGRACION.md`. NO cambiar los
// nombres de las claves del body sin avisarles: hay un tercero implementando
// contra ellas.
//
// Body: { referencia*, marca, modelo, anio, talla, motorizacion, disciplina, color,
//         precio, precio_nuevo, altura_min_cm, altura_max_cm, puntaje,
//         nota_cuadro, nota_suspensiones, nota_frenos_transmision,
//         nota_ruedas_componentes, nota_motor_bateria, nota_electronica,
//         km_motor, salud_bateria_pct, ciclos_carga, material_cuadro,
//         componentes, mejoras, geometria, estado_honesto, por_que_amarla,
//         stock, fotos[] }
//   * `referencia` es la ÚNICA obligatoria: es la llave. El upsert va por ahí,
//     así que reenviar el mismo payload actualiza en vez de duplicar.
//
// 🔑 LA IDEA CENTRAL DEL DISEÑO: Ailoo manda DATOS PLANOS (números sueltos y una
// línea por ítem) y NOSOTROS componemos los strings con formato que espera el
// contrato de Airtable — `Rango altura` ("178 a 188 cm"), `Desglose puntaje`
// ("Área: 6.8/7" por línea) y `Specs clave` (bloques "# Grupo"). Así su formulario
// no tiene que pedir ningún formato y el contrato con `build.mjs` / `mc-match`
// queda intacto. Si algún día se toca `parseSpecs` o `parseRangoAltura`, hay que
// mirar acá también.
//
// Respuestas (son parte del contrato publicado, no cambiarlas a la ligera):
//   200 {ok:true, accion:'creada'|'actualizada', id}   · recibido
//   400 {ok:false, error:'falta_referencia'|'json_invalido'}  · NO reintentar
//   401 {ok:false, error:'clave_invalida'}             · NO reintentar
//   502/503                                            · reintentar (1, 5, 25 min)
//
// GET devuelve una ficha del endpoint (para que quien integra confirme que la URL
// está viva sin tener que mandar un POST a ciegas).
// ?dry=1 → devuelve el mapeo completo y NO escribe nada.
//
// Lee con AIRTABLE_TOKEN, escribe con AIRTABLE_WRITE_TOKEN. Protegido por env
// AILOO_KEY (?key= o cabecera X-API-Key). Sin esa env el endpoint queda ABIERTO
// (mismo criterio que los puentes mc-*) y lo dice en cada respuesta: setearla
// antes de entregar la URL.

const JSONH = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj, null, 2), { status, headers: JSONH });

const BASE_DEFAULT = 'appQUgk8aeD752923';
const FOTOS_FIELD_ID = 'fldydP29nNX03tiZz';   // «Fotos galería» en Inventario
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function afetch(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, opts);
    if (r.status !== 429 || i >= tries - 1) return r;
    await new Promise(res => setTimeout(res, 1200 * (i + 1)));
  }
}

function keyOk(env, request, url) {
  const need = env.AILOO_KEY;
  if (!need) return true;                       // sin env → abierto (y se avisa)
  return url.searchParams.get('key') === need || request.headers.get('X-API-Key') === need;
}

// ── Normalizadores ──────────────────────────────────────────────────────────
const txt = (v, max = 100000) => (v == null || v === '') ? null : String(v).trim().slice(0, max) || null;

const entero = (v) => {
  if (v == null || v === '') return null;
  const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

const decimal = (v) => {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// «6.5» / «7» — sin ceros de relleno, igual que los desgloses ya cargados a mano.
const nota = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

// Acepta «electrica», «Eléctrica», «E-BIKE»… y devuelve la opción exacta del select.
function unDe(valor, mapa) {
  if (valor == null || valor === '') return null;
  const k = String(valor).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  return mapa[k] || null;
}
const MOTOR = { electrica: 'Eléctrica', electric: 'Eléctrica', ebike: 'Eléctrica', 'e-bike': 'Eléctrica', muscular: 'Muscular', mecanica: 'Muscular' };
const DISCIP = { mtb: 'MTB', montana: 'MTB', ruta: 'Ruta', road: 'Ruta', urbana: 'Urbana', urbano: 'Urbana', ciudad: 'Urbana' };

// Una línea por ítem, sin vacías. Tolera \r\n y viñetas pegadas por copy-paste.
const lineas = (v) => String(v || '')
  .split(/\r?\n/).map(s => s.trim().replace(/^[-•*]\s*/, '')).filter(Boolean);

// ── Los tres compositores ───────────────────────────────────────────────────
// El orden del desglose importa: la tarjeta del catálogo dibuja como barras las
// CUATRO PRIMERAS filas (build.mjs → `bars: b.desglose.slice(0,4)`). Por eso en
// una e-bike «Motor y batería» va segundo: es lo que el comprador quiere ver.
const AREAS_MUSCULAR = [
  ['nota_cuadro', 'Cuadro y estructura'],
  ['nota_suspensiones', 'Suspensiones'],
  ['nota_frenos_transmision', 'Frenos y transmisión'],
  ['nota_ruedas_componentes', 'Ruedas y componentes'],
  ['nota_electronica', 'Electrónica'],
];
const AREAS_ELECTRICA = [
  ['nota_cuadro', 'Cuadro y estructura'],
  ['nota_motor_bateria', 'Motor y batería'],
  ['nota_suspensiones', 'Suspensiones'],
  ['nota_frenos_transmision', 'Frenos y transmisión'],
  ['nota_ruedas_componentes', 'Ruedas y componentes'],
  ['nota_electronica', 'Electrónica'],
];

export function componerDesglose(data, esElectrica) {
  const areas = esElectrica ? AREAS_ELECTRICA : AREAS_MUSCULAR;
  const filas = [];
  for (const [clave, etiqueta] of areas) {
    const n = decimal(data?.[clave]);
    if (n == null || n <= 0) continue;
    filas.push(`${etiqueta}: ${nota(n)}/7`);
  }
  return filas.length ? filas.join('\n') : null;
}

// «178 a 188 cm» — el mismo formato que ya está cargado, para no mover el suelo
// bajo `parseRangoAltura` de mc-match (que igual tolera cm y metros).
export function componerRangoAltura(data) {
  const a = entero(data?.altura_min_cm);
  const b = entero(data?.altura_max_cm);
  if (a == null && b == null) return null;
  if (a == null || b == null) return `${a ?? b} cm`;
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return `${lo} a ${hi} cm`;
}

// Los upgrades van PRIMERO y con encabezado propio: son la mayor diferencia de
// precio con una unidad de fábrica y, mezclados, se pierden. `parseSpecs` los lee
// como grupo y la ficha imprimible los muestra con su título.
export function componerSpecs(data) {
  const comp = lineas(data?.componentes);
  const mej = lineas(data?.mejoras);
  const out = [];
  if (mej.length) out.push('# Upgrades incluidos', ...mej);
  if (comp.length) out.push('# Componentes', ...comp);
  return out.length ? out.join('\n') : null;
}

// ── Mapeo completo (puro: sin red, testeable, y es lo que devuelve ?dry=1) ──
export function mapearAiloo(data) {
  const avisos = [];
  const f = {};
  const set = (campo, valor) => { if (valor != null && valor !== '') f[campo] = valor; };

  const referencia = txt(data?.referencia, 40);
  set('Referencia', referencia);

  const motorizacion = unDe(data?.motorizacion, MOTOR);
  if (data?.motorizacion && !motorizacion) avisos.push(`motorizacion no reconocida: «${data.motorizacion}» (se esperaba electrica o muscular)`);
  const esElectrica = motorizacion === 'Eléctrica';

  const disciplina = unDe(data?.disciplina, DISCIP);
  if (data?.disciplina && !disciplina) avisos.push(`disciplina no reconocida: «${data.disciplina}» (se esperaba mtb, ruta o urbana)`);

  set('Marca', txt(data?.marca, 60));
  set('Modelo', txt(data?.modelo, 120));
  set('Año', entero(data?.anio ?? data?.['año']));
  set('Talla', txt(data?.talla, 10)?.toUpperCase());
  set('Motorización', motorizacion);
  set('Disciplina', disciplina);
  set('Color', txt(data?.color, 60));

  set('Precio', entero(data?.precio));
  set('Precio nuevo', entero(data?.precio_nuevo));
  set('Rango altura', componerRangoAltura(data));

  const puntaje = decimal(data?.puntaje);
  if (puntaje != null && (puntaje < 1 || puntaje > 7)) {
    avisos.push(`puntaje fuera de escala: ${puntaje} (la escala es 1 a 7)`);
  } else set('Puntaje certificación', puntaje);
  set('Desglose puntaje', componerDesglose(data, esElectrica));

  // Diagnóstico: solo tiene sentido en eléctricas. Si llega en una muscular se
  // ignora y se avisa, en vez de ensuciar la ficha con un dato imposible.
  const km = entero(data?.km_motor);
  const pct = decimal(data?.salud_bateria_pct);
  const cic = entero(data?.ciclos_carga);
  if (!esElectrica && (km != null || pct != null || cic != null)) {
    avisos.push('diagnóstico ignorado: la bicicleta no está marcada como eléctrica');
  } else {
    set('Diag · km motor', km);
    set('Diag · ciclos', cic);
    // El campo de Airtable es de tipo «percent»: guarda la FRACCIÓN (0.92) y el
    // build multiplica por 100 para mostrar «92%». Ailoo manda el entero.
    if (pct != null) {
      if (pct < 0 || pct > 100) avisos.push(`salud_bateria_pct fuera de rango: ${pct} (se espera 0 a 100)`);
      else f['Diag · salud batería'] = Math.round(pct) / 100;
    }
  }

  set('Material cuadro', txt(data?.material_cuadro, 200));
  set('Specs clave', componerSpecs(data));
  set('Geometría', lineas(data?.geometria).join('\n') || null);
  set('Estado honesto', lineas(data?.estado_honesto).join('\n') || null);
  set('Por qué amarla', txt(data?.por_que_amarla, 4000));

  const fotos = (Array.isArray(data?.fotos) ? data.fotos : (data?.fotos ? [data.fotos] : []))
    .map(u => String(u).trim()).filter(u => /^https?:\/\//i.test(u));
  if (data?.fotos && !fotos.length) avisos.push('ninguna URL de foto válida (deben ser absolutas y empezar con http)');

  const stock = entero(data?.stock);

  return { referencia, fields: f, fotos, stock, esElectrica, avisos };
}

// ── Estado de inventario a partir del stock ─────────────────────────────────
// Regla conservadora: el stock de Ailoo NUNCA pisa una «Reservada» (esa la maneja
// el equipo con una seña de por medio) ni degrada una «Disponible». Solo mueve en
// las dos transiciones que importan: se vendió, y volvió a estar a la venta.
export function estadoSegunStock(stock, estadoActual) {
  if (stock == null) return null;
  if (stock <= 0) return estadoActual === 'Vendida' ? null : 'Vendida';
  return ['Vendida', 'Borrador', 'En reacondicionamiento'].includes(estadoActual) ? 'Disponible' : null;
}

const cfg = (env) => {
  const BASE = env.AIRTABLE_BASE || BASE_DEFAULT;
  const READ = env.AIRTABLE_TOKEN || env.AIRTABLE_WRITE_TOKEN;
  const WRITE = env.AIRTABLE_WRITE_TOKEN;
  const INV = env.AIRTABLE_INVENTARIO_TABLE || 'Inventario';
  return {
    BASE, READ, WRITE, INV,
    api: `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(INV)}`,
    rH: { Authorization: `Bearer ${READ}` },
    wH: { Authorization: `Bearer ${WRITE}`, 'Content-Type': 'application/json' },
    DEPLOY_HOOK: env.DEPLOY_HOOK_URL || '',
  };
};

// ── Fotos (asíncrono, fuera de la respuesta) ────────────────────────────────
// Airtable NO puede ingerir por URL desde el CDN de Ailoo (su fetcher server-side
// queda bloqueado y el campo queda vacío EN SILENCIO). Hay que bajar el binario
// con User-Agent de navegador y subirlo por `uploadAttachment`.
function bytesABase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {       // por trozos: evita reventar el stack
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

async function subirFotos(C, recId, urls) {
  const res = { subidas: 0, fallidas: [] };
  for (const url of urls.slice(0, 20)) {
    try {
      const img = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!img.ok) { res.fallidas.push(`${url} (HTTP ${img.status})`); continue; }
      const buf = await img.arrayBuffer();
      if (buf.byteLength > 4 * 1024 * 1024) { res.fallidas.push(`${url} (pesa más de 4 MB)`); continue; }
      const up = await afetch(
        `https://content.airtable.com/v0/${C.BASE}/${recId}/${FOTOS_FIELD_ID}/uploadAttachment`,
        { method: 'POST', headers: C.wH, body: JSON.stringify({
          contentType: img.headers.get('content-type') || 'image/jpeg',
          file: bytesABase64(buf),
          filename: (url.split('/').pop() || 'foto.jpg').split('?')[0],
        }) });
      if (up.ok) res.subidas++; else res.fallidas.push(`${url} (Airtable ${up.status})`);
    } catch (e) { res.fallidas.push(`${url} (${e.message})`); }
  }
  return res;
}

// ── GET: ficha del endpoint, para quien está integrando ─────────────────────
export async function onRequestGet({ env }) {
  return reply({
    ok: true,
    endpoint: 'ailoo-bici',
    descripcion: 'Puente Ailoo → inventario de Bike Trust. Alta y actualización de bicicletas.',
    metodo: 'POST',
    content_type: 'application/json; charset=utf-8',
    autenticacion: env.AILOO_KEY ? 'obligatoria: ?key=… o cabecera X-API-Key' : 'SIN CLAVE CONFIGURADA (el endpoint está abierto)',
    llave_de_upsert: 'referencia',
    modo_prueba: 'añadir ?dry=1 — devuelve el mapeo completo y no escribe nada',
    campo_obligatorio: 'referencia',
    contrato: 'Requerimiento técnico para Ailoo, secciones 2 y 4',
  });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const url = new URL(request.url);
  if (!keyOk(env, request, url)) return reply({ ok: false, error: 'clave_invalida' }, 401);

  let data;
  try { data = await request.json(); }
  catch { return reply({ ok: false, error: 'json_invalido' }, 400); }

  const m = mapearAiloo(data);
  if (!m.referencia) return reply({ ok: false, error: 'falta_referencia' }, 400);

  const sinClave = env.AILOO_KEY ? undefined : 'sin_clave_configurada';

  // ── Modo prueba: devolvemos exactamente lo que escribiríamos ──────────────
  if (url.searchParams.get('dry') === '1') {
    return reply({
      ok: true, dry: true, accion: 'simulada', referencia: m.referencia,
      campos_airtable: m.fields,
      estado_calculado: m.stock == null ? '(no se envió stock: no se toca el estado)'
        : (m.stock <= 0 ? 'Vendida' : 'Disponible, salvo que ya esté Disponible o Reservada'),
      fotos_recibidas: m.fotos.length,
      avisos: m.avisos,
      aviso_seguridad: sinClave,
    });
  }

  const C = cfg(env);
  if (!C.READ || !C.WRITE) return reply({ ok: false, error: 'no_configurado' }, 503);

  // ── Upsert por Referencia ─────────────────────────────────────────────────
  const buscar = `${C.api}?maxRecords=1&filterByFormula=${encodeURIComponent(`{Referencia}='${m.referencia.replace(/'/g, "\\'")}'`)}`;
  const rr = await afetch(buscar, { headers: C.rH });
  if (!rr.ok) return reply({ ok: false, error: 'airtable_read', status: rr.status, detail: await rr.text() }, 502);
  const existente = (await rr.json()).records?.[0] || null;

  const fields = { ...m.fields };
  const hoy = new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10); // Chile UTC-4

  const nuevoEstado = estadoSegunStock(m.stock, existente?.fields?.Estado || null);
  if (existente) {
    if (nuevoEstado) fields.Estado = nuevoEstado;
    if (nuevoEstado === 'Vendida' && !existente.fields?.['Fecha venta']) fields['Fecha venta'] = hoy;
  } else {
    fields.Estado = m.stock != null && m.stock <= 0 ? 'Vendida' : 'Disponible';
    if (fields.Estado === 'Vendida') fields['Fecha venta'] = hoy;
  }

  let recId, accion;
  if (existente) {
    const pr = await afetch(`${C.api}/${existente.id}`, {
      method: 'PATCH', headers: C.wH, body: JSON.stringify({ typecast: true, fields }),
    });
    if (!pr.ok) return reply({ ok: false, error: 'airtable_update', status: pr.status, detail: await pr.text() }, 502);
    recId = existente.id; accion = 'actualizada';
  } else {
    const cr = await afetch(C.api, {
      method: 'POST', headers: C.wH, body: JSON.stringify({ typecast: true, fields }),
    });
    if (!cr.ok) return reply({ ok: false, error: 'airtable_create', status: cr.status, detail: await cr.text() }, 502);
    recId = (await cr.json()).id; accion = 'creada';
  }

  // ── Fotos y republicación: DESPUÉS de responder ───────────────────────────
  // Bajar y subir seis fotos no cabe en los 3 segundos que le prometimos a Ailoo,
  // y hacerlos esperar provocaría timeouts y reintentos. `waitUntil` deja el
  // trabajo corriendo con la respuesta ya entregada.
  //
  // Las fotos solo se ingieren si la galería está VACÍA. Es a propósito: varias
  // bicis tienen fotos curadas a mano y una actualización de precio desde Ailoo
  // no puede borrarlas.
  const galeriaVacia = !Array.isArray(existente?.fields?.['Fotos galería']) || existente.fields['Fotos galería'].length === 0;
  const tareas = (async () => {
    if (m.fotos.length && galeriaVacia) await subirFotos(C, recId, m.fotos);
    if (C.DEPLOY_HOOK) {
      try { await fetch(C.DEPLOY_HOOK, { method: 'POST' }); } catch { /* el sitio se reconstruye igual en el próximo push */ }
    }
  })();
  if (ctx.waitUntil) ctx.waitUntil(tareas); else await tareas;

  return reply({
    ok: true,
    accion,
    id: recId,
    fotos: m.fotos.length === 0 ? 'sin fotos en el envío'
      : (galeriaVacia ? `${m.fotos.length} en proceso` : 'la galería ya tenía fotos: no se tocaron'),
    republicacion: C.DEPLOY_HOOK ? 'gatillada' : 'no configurada (el sitio se reconstruye en el próximo despliegue)',
    ...(m.avisos.length ? { avisos: m.avisos } : {}),
    ...(sinClave ? { aviso_seguridad: sinClave } : {}),
  });
}
