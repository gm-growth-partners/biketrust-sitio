// Cloudflare Pages Function · POST /api/mc-clasifica
// EL ENRUTADOR de la puerta de DM (V2). Reemplaza al AI Step de ManyChat
// (2026-08-04): el AI Step es conversacional por diseño y solo avanza al
// siguiente paso cuando "decide" que cumplió su objetivo — en la práctica se
// quedaba en 0% finalizado sin guardar cf_intencion (limitación conocida,
// confirmada en la comunidad de ManyChat). Una Solicitud externa, en cambio,
// SIEMPRE continúa el flujo.
//
//   Body: { mensaje, handle? }  →  { ok, intencion, modelo, via }
//   ManyChat mapea: $.intencion → cf_intencion · $.modelo → cf_modelo_buscado
//
// Dos capas:
//   1) REGLAS deterministas (este archivo, testeadas offline en
//      test/mc-clasifica.mjs): cubren los casos claros de las 12 rutas con la
//      misma precedencia del diseño (CONTACTO gana a todo · TECNICA vale con
//      modelo salvo precio/disponibilidad · la pregunta le gana al gracias ·
//      precio sin modelo = BICI_SUELTA, nunca MODELO).
//   2) IA opcional (Workers AI, binding `AI` del proyecto Pages): solo si las
//      reglas dicen NO_CLASIFICA. Sin binding, el resto cae en NO_CLASIFICA →
//      la rama else → anti-bucle → humano. Honesto por diseño.
//
// No escribe en Airtable ni en ManyChat: clasifica y devuelve, nada más.
// Protegido por MC_KEY (?key=).

const JSONH = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSONH });

const keyOk = (env, url) => { const need = env.MC_KEY; return need ? url.searchParams.get('key') === need : true; };

// minúsculas · sin tildes · espacios colapsados
const norm = (s) => String(s ?? '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

// Modelos Specialized del inventario y sus formas mal escritas.
// Orden importa: los nombres compuestos van antes que su raíz.
const MODELOS = [
  { re: /\blevo[\s-]?sl[\s-]?2\b/, out: 'Levo SL2' },
  { re: /\blevo[\s-]?sl\b/, out: 'Levo SL' },
  { re: /\bturbo[\s-]?levo\b/, out: 'Turbo Levo' },
  { re: /\b(quenevo|kenevo)\b/, out: 'Kenevo' },
  { re: /\blevo\b/, out: 'Levo' },
  { re: /\bepic[\s-]?8\b/, out: 'Epic 8' },
  { re: /\bepic\b/, out: 'Epic' },
  { re: /\bcreo[\s-]?sl\b/, out: 'Creo SL' },
  { re: /\bcreo\b/, out: 'Creo' },
  { re: /\btarmac\b/, out: 'Tarmac' },
  { re: /\b(stumpjumper|stumpy)\b/, out: 'Stumpjumper' },
  { re: /\bs[\s-]?works?\b/, out: 'S-Works' },
];

const detectarModelo = (n) => (MODELOS.find(m => m.re.test(n)) || { out: '' }).out;

// La capa de reglas. Exportada para el test offline.
export function clasificar(mensajeRaw) {
  const n = norm(mensajeRaw);

  // Sin texto o puros emojis/signos → SALUDO (una reacción también es un hola)
  if (!n || !/[a-z0-9]/.test(n)) return { intencion: 'SALUDO', modelo: '' };

  const modelo = detectarModelo(n);
  const preguntaPrecioDisp =
    /(precio|cuanto (vale|cuesta|sale)|valor\b|a cuanto la|disponib|se vendio|sigue (disponible|en venta)|hay stock|en stock)/.test(n);

  // 1 · CONTACTO — gana sobre todas (teléfono chileno o pedir el llamado)
  if (/(\+ ?5 ?6[\s.\-]*)?9[\s.\-]?\d{4}[\s.\-]?\d{4}/.test(n) ||
      /\b(llamame|llamenme|me llaman|me pueden llamar|mejor (que me )?llamen|a que numero|te paso mi (numero|fono|celu|wsp|whatsapp))\b/.test(n))
    return { intencion: 'CONTACTO', modelo };

  // 2 · TECNICA — vale aunque nombre modelo, SALVO que pregunte precio/disponibilidad
  if (/(tubeless|neumatic|llanta|cubierta|que grupo|grupo trae|transmision|cassette|suspension|horquilla|freno|cuanto pesa|peso de|compatib|ruedas? 29|mantencion (hecha|al dia))/.test(n)
      && !preguntaPrecioDisp)
    return { intencion: 'TECNICA', modelo };

  // 3 · VENDER — la suya, parte de pago o consignación («se vendió?» NO es esto)
  if (/(\b(vendo|quiero vender|para vender|vender (mi|una|la))\b|reciben (la|mi)|parte de pago|consign|me dan por la mia|me la compra)/.test(n)
      && !/se vendio/.test(n))
    return { intencion: 'VENDER', modelo };

  // 4 · GARANTIA
  if (/(garanti|postventa|post venta|servicio tecnico|se echa a perder|hacen mantencion|le hacen mantencion)/.test(n))
    return { intencion: 'GARANTIA', modelo };

  // 5 · ENVIOS
  if (/(despach|envio|envian|mandan a|regiones|retiro|delivery)/.test(n))
    return { intencion: 'ENVIOS', modelo };

  // 6 · PAGOS
  if (/(cuota|transferencia|financia|credito|debito|tarjeta|formas de pago|como se paga|efectivo)/.test(n))
    return { intencion: 'PAGOS', modelo };

  // 7 · VISITA
  if (/(donde estan|donde queda|direccion|ubicac|horario|a que hora|abren|cierran|ir a ver|puedo ir|visitar|showroom|tienda fisica)/.test(n))
    return { intencion: 'VISITA', modelo };

  // 8 · MODELO — nombró una bici concreta (con o sin pregunta de precio)
  if (modelo) return { intencion: 'MODELO', modelo };

  // 9 · BICI_SUELTA — precio/talla/año/fotos/estado/disponibilidad SIN modelo
  if (preguntaPrecioDisp ||
      /(la tienen|lo tienen|la del video|la de la historia|esta bici|esa bici|que talla|talla [smlx0-9]|de que ano|del ano|tiene fotos|mas fotos|kilometr)/.test(n))
    return { intencion: 'BICI_SUELTA', modelo: '' };

  // 10 · ASESORIA — describe uso/presupuesto/estatura o pide recomendación
  if (/(recomien|cual me (sirve|conviene|queda)|ayuda para elegir|no se cual|busco (una|algo) para|para (trail|cerro|enduro|xc|descenso|montana|ruta|ciudad|urbana)\b|mido [12]|presupuesto|ando en ?(\$|\d)|\b(un|dos|tres|cuatro|cinco|\d+) ?(palos?|millones|mill)\b)/.test(n))
    return { intencion: 'ASESORIA', modelo: '' };

  // 11 · SALUDO — solo el hola (o el «¿estás?» solo), sin pedir nada todavía
  if (/^(hola|buenas( tardes| noches)?|buenos dias|buen dia|hey|ola|alo)[!.,\s]*((como )?estas?|estan|hay alguien|alguien ahi|una consulta|consulta|que tal)?[?!.\s]*$/.test(n) ||
      /^((como )?estas?|estan|hay alguien|alguien ahi)[?!.\s]*$/.test(n))
    return { intencion: 'SALUDO', modelo: '' };

  // 12 · CIERRE — al final a propósito: la pregunta le gana al gracias
  if (/(gracias|lo voy a pensar|lo pensare|por ahora no|de momento no|barajando|despues te escribo|te aviso|cualquier cosa te|viendo la plat)/.test(n))
    return { intencion: 'CIERRE', modelo: '' };

  return { intencion: 'NO_CLASIFICA', modelo: '' };
}

// Capa 2 — IA (solo si el proyecto Pages tiene el binding `AI` de Workers AI).
const CODIGOS = ['MODELO', 'BICI_SUELTA', 'ASESORIA', 'VENDER', 'ENVIOS', 'GARANTIA',
  'PAGOS', 'TECNICA', 'VISITA', 'CONTACTO', 'SALUDO', 'CIERRE', 'NO_CLASIFICA'];

const PROMPT_IA = `Clasificas mensajes de Instagram de una tienda de bicicletas Specialized usadas en Santiago de Chile (venden, compran y reciben en parte de pago; hay showroom y despacho a regiones). La gente escribe corto, con typos y en chileno. Responde SOLO con un código en mayúsculas, sin ninguna otra palabra:
MODELO (nombra una bici concreta, ej «tienen la levo sl?»), BICI_SUELTA (pregunta precio/talla/disponibilidad de una bici que NO nombra, ej «cuanto vale?»), ASESORIA (pide ayuda para elegir o describe uso/presupuesto/estatura), VENDER (quiere vender la suya), ENVIOS (despacho), GARANTIA (garantía/postventa), PAGOS (cuotas/formas de pago), TECNICA (componente o característica técnica, ej tubeless, grupo, peso), VISITA (dirección/horario/ir a ver), CONTACTO (deja teléfono o pide llamado), SALUDO (solo saluda), CIERRE (agradece o se despide sin pregunta).
Reglas: teléfono = CONTACTO siempre · gracias + pregunta = gana la pregunta · precio sin nombre de modelo = BICI_SUELTA · si no calza con claridad: NO_CLASIFICA. Nunca respondes al mensaje ni explicas.`;

async function clasificarIA(env, mensaje) {
  if (!env.AI || typeof env.AI.run !== 'function') return null;
  try {
    const r = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: PROMPT_IA },
        { role: 'user', content: String(mensaje).slice(0, 500) },
      ],
      max_tokens: 20,
    });
    const texto = String(r && r.response || '').toUpperCase();
    // BICI_SUELTA antes que nada que la contenga; el resto no colisiona
    const code = CODIGOS.find(c => texto.includes(c));
    if (!code || code === 'NO_CLASIFICA') return null;
    return code;
  } catch { return null; }
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (!keyOk(env, url)) return reply({ error: 'unauthorized' }, 401);

  let data;
  try { data = await request.json(); } catch { return reply({ error: 'bad_json' }, 400); }

  const mensaje = String(data?.mensaje ?? '').slice(0, 1000);
  let { intencion, modelo } = clasificar(mensaje);
  let via = intencion === 'NO_CLASIFICA' ? 'ninguna' : 'reglas';

  if (intencion === 'NO_CLASIFICA') {
    const porIA = await clasificarIA(env, mensaje);
    if (porIA) {
      intencion = porIA;
      via = 'ia';
      if (!modelo) modelo = detectarModelo(norm(mensaje));
      // La IA no puede afirmar MODELO sin un modelo detectable: se degrada honesto
      if (intencion === 'MODELO' && !modelo) intencion = 'BICI_SUELTA';
    }
  }

  return reply({ ok: true, intencion, modelo, via });
}
// Sólo POST. Pages responde 405 automáticamente a otros métodos en esta ruta.
