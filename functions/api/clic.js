/**
 * /api/clic — medición del sitio (vistas de página y clics en CTA).
 *
 * POST  → registra un evento. Lo llama el beacon de cada página.
 * GET   → describe el endpoint y dice si el binding D1 está puesto (sin clave).
 * GET ?resumen=1&key=… → agregados que consume el build del tablero.
 *
 * TRES REGLAS DE DISEÑO, y las tres importan:
 *
 * 1. **Nunca romper el sitio.** Si falta el binding D1, si el JSON viene malo, si la
 *    escritura falla — siempre 204. La medición es un accesorio; una página que se
 *    cae porque no pudo contar un clic es un cambio malo. Por eso tampoco hay
 *    reintentos ni esperas.
 * 2. **Sin dato personal.** No se guarda IP, ni cookie, ni user-agent, ni huella. Ver
 *    el comentario de `d1/schema.sql`.
 * 3. **Listas blancas.** `tipo` y `cta` se validan contra un set cerrado; todo lo demás
 *    se recorta a un largo máximo. El cuerpo llega de un navegador cualquiera: es
 *    entrada hostil por definición.
 */

const TIPOS = new Set(['vista', 'clic']);

// Los CTA que el sitio emite hoy. Un `data-cta` que no esté acá se guarda como
// 'otro' en vez de descartarse, para que un botón nuevo sin registrar no desaparezca
// en silencio — aparecerá en el resumen y delatará que falta agregarlo acá.
const CTAS = new Set([
  // los cuatro que definen el embudo de la puerta web
  'ficha', 'encargo', 'consigna', 'general',
  // 'ficha' tiene DOS botones en la misma página: el grande del riel y el de la barra
  // superior. Se cuentan aparte para saber cuál de los dos hace el trabajo.
  'ficha_top',
  // WhatsApp general según dónde se apretó
  'general_top', 'general_barra', 'general_pie',
  // CTA secundarios de la ficha y las páginas informativas
  'asesoria', 'parte_pago', 'cert', 'garantia', 'guias', 'fotos_placa', 'detalle_fotos',
  'detalle', 'certificado', 'escaneo', 'calce', 'pregunta', 'avisame',
  'otro_wa', 'otro',
]);

const MAX_CUERPO = 1200; // bytes; un evento legítimo pesa ~200

const txt = (v, max) => {
  // Recorta a caracteres imprimibles y al largo maximo en una sola pasada. Se hace
  // a mano y no con regex porque los rangos de control se escriben mal con facilidad.
  const crudo = String(v == null ? '' : v);
  let s = '';
  for (let k = 0; k < crudo.length && s.length < max; k++) {
    const c = crudo.charCodeAt(k);
    if (c > 31 && c !== 127) s += crudo[k];
  }
  s = s.trim();
  return s || null;
};

// Día calendario en Santiago. `dia` existe para que el tablero agrupe sin convertir
// zonas horarias en SQL: un evento de las 22:00 en Chile es del mismo día laboral,
// aunque en UTC ya sea el siguiente.
const diaSantiago = (d) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);

const ES_BOT = /bot|crawl|spider|slurp|bing|yandex|baidu|duckduck|facebookexternalhit|preview|headless|lighthouse|pingdom|monitor/i;

const vacio = () => new Response(null, { status: 204 });

export async function onRequestPost({ request, env }) {
  try {
    // Sin binding no hay dónde escribir. Se responde OK igual: el sitio no se entera.
    if (!env.DB) return vacio();

    // Los rastreadores inflan las vistas y no compran bicicletas.
    if (ES_BOT.test(request.headers.get('user-agent') || '')) return vacio();

    const crudo = await request.text();
    if (!crudo || crudo.length > MAX_CUERPO) return vacio();

    let b;
    try { b = JSON.parse(crudo); } catch { return vacio(); }
    if (!b || typeof b !== 'object') return vacio();

    const tipo = String(b.t || '');
    if (!TIPOS.has(tipo)) return vacio();

    const pagina = txt(b.p, 120);
    const sesion = txt(b.s, 24);
    if (!pagina || !sesion) return vacio();

    // Un clic sin CTA no dice nada; una vista con CTA es un error del cliente.
    let cta = null;
    if (tipo === 'clic') {
      const c = txt(b.c, 32);
      if (!c) return vacio();
      cta = CTAS.has(c) ? c : 'otro';
    }

    const ahora = new Date();

    await env.DB.prepare(
      `INSERT INTO eventos (ts, dia, tipo, cta, ref, pagina, origen, disp, sesion)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
    ).bind(
      ahora.toISOString(),
      diaSantiago(ahora),
      tipo,
      cta,
      txt(b.r, 40),
      pagina,
      txt(b.o, 40),
      b.d === 'movil' ? 'movil' : 'escritorio',
      sesion,
    ).run();

    return vacio();
  } catch {
    // Ver regla 1. Un error acá no puede ser un error para el visitante.
    return vacio();
  }
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const json = (o, s = 200) =>
    new Response(JSON.stringify(o, null, 2), {
      status: s,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });

  if (url.searchParams.get('resumen') !== '1') {
    return json({
      endpoint: '/api/clic',
      que_hace: 'Registra vistas de página y clics en CTA para el embudo de la puerta web.',
      d1: env.DB ? 'binding DB presente' : 'FALTA el binding DB — no se está guardando nada',
      resumen: 'GET /api/clic?resumen=1&key=… (env MEDICION_KEY)',
      ctas: [...CTAS],
    });
  }

  if (!env.MEDICION_KEY) return json({ error: 'falta_env:MEDICION_KEY' }, 503);
  if (url.searchParams.get('key') !== env.MEDICION_KEY) return json({ error: 'clave_invalida' }, 401);
  if (!env.DB) return json({ error: 'falta_binding:DB' }, 503);

  // `desde` acota la ventana; por defecto 90 días, que es más historia de la que el
  // sitio va a tener en meses.
  const desde = txt(url.searchParams.get('desde'), 10) || '2000-01-01';

  const q = (sql) => env.DB.prepare(sql).bind(desde).all();
  try {
    const [porCta, fichas, porDia, sesiones, flujos] = await Promise.all([
      q(`SELECT cta, COUNT(*) n, COUNT(DISTINCT sesion) personas
           FROM eventos WHERE tipo='clic' AND dia>=?1 GROUP BY cta ORDER BY n DESC`),
      q(`SELECT ref,
                SUM(CASE WHEN tipo='vista' THEN 1 ELSE 0 END)              vistas,
                COUNT(DISTINCT CASE WHEN tipo='vista' THEN sesion END)     personas,
                SUM(CASE WHEN tipo='clic' AND cta='ficha' THEN 1 ELSE 0 END) clic_ficha
           FROM eventos WHERE ref IS NOT NULL AND dia>=?1
          GROUP BY ref ORDER BY vistas DESC`),
      q(`SELECT dia,
                SUM(CASE WHEN tipo='vista' THEN 1 ELSE 0 END) vistas,
                SUM(CASE WHEN tipo='clic'  THEN 1 ELSE 0 END) clics,
                COUNT(DISTINCT sesion)                        sesiones
           FROM eventos WHERE dia>=?1 GROUP BY dia ORDER BY dia DESC`),
      q(`SELECT COUNT(DISTINCT sesion) sesiones,
                COUNT(DISTINCT CASE WHEN pagina LIKE '/bici/%' THEN sesion END) sesiones_ficha,
                SUM(CASE WHEN tipo='vista' AND pagina LIKE '/bici/%' THEN 1 ELSE 0 END) vistas_ficha
           FROM eventos WHERE dia>=?1`),
      // Los 4 flujos de la puerta web, contados en PERSONAS (sesiones distintas) y no en
      // clics. Se agrupa acá y no en el tablero porque 'ficha' y 'ficha_top' son dos
      // botones para lo MISMO: sumarlos por fuera contaría dos veces a quien apretó ambos.
      q(`SELECT
           -- Los totales se acotan a los CTA de los 4 flujos. Si contaran todos los
           -- botones (certificado, preguntas, parte de pago…) el TOTAL no cuadraría
           -- con la suma de las filas y se leería como un error.
           COUNT(DISTINCT CASE WHEN cta IN ('ficha','ficha_top','encargo','consigna',
                 'general','general_top','general_barra','general_pie') THEN sesion END) personas,
           SUM(CASE WHEN cta IN ('ficha','ficha_top','encargo','consigna',
                 'general','general_top','general_barra','general_pie') THEN 1 ELSE 0 END) clics,
           COUNT(DISTINCT CASE WHEN cta IN ('ficha','ficha_top') THEN sesion END) ficha,
           COUNT(DISTINCT CASE WHEN cta='encargo'  THEN sesion END)               encargo,
           COUNT(DISTINCT CASE WHEN cta='consigna' THEN sesion END)               consigna,
           COUNT(DISTINCT CASE WHEN cta IN ('general','general_top','general_barra','general_pie')
                 THEN sesion END)                                                 general,
           SUM(CASE WHEN cta IN ('ficha','ficha_top') THEN 1 ELSE 0 END)          ficha_clics,
           SUM(CASE WHEN cta='encargo'  THEN 1 ELSE 0 END)                        encargo_clics,
           SUM(CASE WHEN cta='consigna' THEN 1 ELSE 0 END)                        consigna_clics,
           SUM(CASE WHEN cta IN ('general','general_top','general_barra','general_pie')
                 THEN 1 ELSE 0 END)                                               general_clics
         FROM eventos WHERE tipo='clic' AND dia>=?1`),
    ]);

    return json({
      desde,
      generado: new Date().toISOString(),
      totales: sesiones.results[0] || {},
      flujos: flujos.results[0] || {},
      porCta: porCta.results,
      porBici: fichas.results,
      porDia: porDia.results,
    });
  } catch (e) {
    return json({ error: 'consulta_fallida', detalle: String(e && e.message || e) }, 500);
  }
}
