// build.mjs — Bike Trust · genera el sitio estático desde Airtable
// Rediseño 2026-08 («certificadas 3»): portada, catálogo, ficha, certificación,
// consigna, encargo y guías. Todo CTA converge en WhatsApp con mensaje por tipo
// de entrada. Lee la vista "Disponibles" + las bicis Vendidas/Reservadas y
// escribe /dist (catálogo + ficha por bici + ficha técnica imprimible + SEO).
// El token solo se usa aquí, en build (lado servidor). El sitio público es HTML estático.

import { mkdir, writeFile, rm, cp } from 'node:fs/promises';

const TOKEN = process.env.AIRTABLE_TOKEN;                         // se crea en Cloudflare (read-only)
const BASE  = process.env.AIRTABLE_BASE  || 'appQUgk8aeD752923'; // base "Bike Trust · Operaciones"
const TABLE = process.env.AIRTABLE_TABLE || 'Inventario';
const VIEW  = process.env.AIRTABLE_VIEW  || 'Disponibles';
const OUT   = 'dist';

/* ---------- datos de ejemplo (modo mock, sin token) ---------- */
const MOCK = [{
  'Marca':'Specialized','Modelo':'Turbo Kenevo Expert','Año':2022,
  'Motorización':'Eléctrica','Disciplina':'eMTB Enduro / Freeride','Talla':'S3',
  'Precio':4000000,'Estado':'Disponible','Destacada':true,
  'Diag · km motor':1335,'Diag · salud batería':0.95,'Diag · ciclos':78,
  'Rango altura':'1,68–1,78 m','Referencia':'4054866',
  'Por qué amarla':'Sube las subidas más duras con energía de sobra. Baja las más largas como un misil.',
  'Desglose puntaje':'Cuadro y Estructura: 6/7\nMotor y Electronica: 6/7\nSuspensiones: 6.3/7\nFrenos y Transmision: 6/7',
  'Puntaje certificación':6.5,
  'Specs clave':'# Motor y batería\nMotor: Specialized 2.1 · +410%\nBatería: M2-Series · 700 Wh\nApp: Mission Control\n# Suspensión y chasis\nHorquilla: RockShox Boxxer 180 mm\nRecorrido: 180 mm del / tras\nChasis: Aluminio M5 · Sidearm'
}];

/* ---------- helpers ---------- */
const num  = v => (v==null||v==='') ? null : Number(v);
const clp  = n => '$' + Number(n).toLocaleString('es-CL');
const esc  = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const escA = s => esc(s).replace(/"/g,'&quot;');                 // escape para atributos (incluye comillas)
const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
                   .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');

function parseSpecs(raw){
  const groups=[]; let cur=null;
  String(raw||'').split('\n').map(l=>l.trim()).filter(Boolean).forEach(l=>{
    if(l.startsWith('#')){ cur={grupo:l.replace(/^#+/,'').trim(),filas:[]}; groups.push(cur); return; }
    if(!cur){ cur={grupo:'Especificaciones',filas:[]}; groups.push(cur); }
    const i=l.indexOf(':');
    cur.filas.push(i>0 ? [l.slice(0,i).trim(), l.slice(i+1).trim()] : ['', l]);
  });
  return groups;
}

// «6.5» / «7» — el puntaje se muestra con punto decimal (igual que el desglose de Airtable).
function fmtPuntaje(v){
  const x = Number(String(v??'').replace(',','.'));
  if(!isFinite(x) || x<=0) return '';
  return String(Math.round(x*10)/10);
}
// Una fila del desglose «Área: 6.3/7» → {label, val:'6.3/7', pct:90}
function desgloseRow([k,v]){
  const m = String(v||'').match(/([\d.,]+)\s*\/\s*7/);
  let pct = null;
  if(m){ const n=Number(m[1].replace(',','.')); if(isFinite(n)) pct=Math.round(n/7*100); }
  else { const n=Number(String(v||'').replace(',','.')); if(isFinite(n)&&n>0&&n<=7) pct=Math.round(n/7*100); }
  return { label:k||'Ítem', val:String(v||'').trim(), pct: pct==null?0:Math.max(0,Math.min(100,pct)) };
}

function mapBike(f, recId){
  const motor = f['Motorización']||'';
  return {
    recId: recId||'',   // id de la fila en Airtable (para enlazar el Interés a la bici exacta)
    marca:f['Marca']||'', modelo:f['Modelo']||'', anio:f['Año']||'',
    electrica: motor.toLowerCase().startsWith('eléctr'),
    disciplina:f['Disciplina']||'', talla:f['Talla']||'',
    precio:num(f['Precio']), precioNuevo:num(f['Precio nuevo']),
    puntaje: (f['Puntaje certificación']??null),
    desglose:String(f['Desglose puntaje']||'').split('\n').map(s=>s.trim()).filter(Boolean).map(l=>{const i=l.indexOf(':'); return i>0?[l.slice(0,i).trim(),l.slice(i+1).trim()]:['',l];}),
    diagKm:num(f['Diag · km motor']), diagBat:(f['Diag · salud batería']==null||f['Diag · salud batería']==='')?null:Math.round(Number(f['Diag · salud batería'])*100), diagCic:num(f['Diag · ciclos']),
    rangoAltura:f['Rango altura']||'', porQue:f['Por qué amarla']||'',
    estado:String(f['Estado honesto']||'').split('\n').map(s=>s.trim()).filter(Boolean),
    specs:parseSpecs(f['Specs clave']),
    geometria:parseSpecs(f['Geometría']),
    referencia:f['Referencia']||'',
    // Estado de inventario (Disponible · Reservada · Vendida) + destacada de portada.
    estadoInv: f['Estado']||'Disponible',
    destacada: !!f['Destacada'],
    fechaVenta: f['Fecha venta']||'',
    fotos: [],   // se resuelve en el build (resolveBikePhotos)
    fotoReferencial: !!f['Foto referencial'],  // foto del MODELO (no la unidad real) → muestra etiqueta honesta
    // Cada «Foto N» es un ADJUNTO (la persona arrastra la foto a ese slot) o, si fuera texto, una URL. Orden 1..13.
    fotoSlots: Array.from({length:13}, (_,i)=>f['Foto '+(i+1)] ?? null),
    // Respaldos: campo adjunto único «Fotos» y campo de texto «Fotos URLs».
    fotosAdjuntos: Array.isArray(f['Fotos galería']) ? f['Fotos galería']
                 : (Array.isArray(f['Fotos']) ? f['Fotos'] : []),
    fotosBulk: String(f['Fotos URLs']||'').split(/[\n,]/).map(s=>s.trim()).filter(Boolean),
    pdf:String(f['Ficha técnica PDF']||f['PDF · URL Cloudflare']||'').trim(),
    material:f['Material cuadro']||f['Material']||''
  };
}
const esVendida   = b => b.estadoInv === 'Vendida';
const esReservada = b => b.estadoInv === 'Reservada';   // con seña (estado de inventario)

// fetch con reintentos: tolera blips de red / 429 / 5xx sin tumbar el build.
async function fetchJSON(u){
  const max=3;
  for(let intento=1; ; intento++){
    let r;
    try{ r=await fetch(u,{headers:{Authorization:`Bearer ${TOKEN}`}}); }
    catch(e){ if(intento>=max) throw e; }
    if(r){
      if(r.ok) return r.json();
      // 4xx (salvo 429) son errores de config: fallar de inmediato, reintentar no ayuda.
      if(r.status<500 && r.status!==429) throw new Error(`Airtable ${r.status}: ${await r.text()}`);
      if(intento>=max) throw new Error(`Airtable ${r.status}: ${await r.text()}`);
    }
    await new Promise(res=>setTimeout(res, 500*intento));
  }
}

async function fetchBikes(){
  if(!TOKEN){ console.warn('⚠  Sin AIRTABLE_TOKEN — usando datos de ejemplo (mock).'); return MOCK.map(f=>mapBike(f)); }
  let out=[], offset;
  do{
    const u=new URL(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE)}`);
    u.searchParams.set('view', VIEW);
    if(offset) u.searchParams.set('offset', offset);
    const j=await fetchJSON(u);
    out=out.concat(j.records.map(rec=>mapBike(rec.fields, rec.id)));
    offset=j.offset;
  } while(offset);
  return out;
}

// Bicis fuera de la vista Disponibles que IGUAL se publican: Vendidas (en gris,
// como prueba de que el sistema vende) y Reservadas con seña. Defensivo: si la
// consulta falla, el sitio sale igual solo con las disponibles.
async function fetchNoDisponibles(){
  if(!TOKEN) return [];
  const out=[];
  try{
    let offset;
    do{
      const u=new URL(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE)}`);
      u.searchParams.set('filterByFormula', "OR({Estado}='Vendida',{Estado}='Reservada')");
      if(offset) u.searchParams.set('offset', offset);
      const j=await fetchJSON(u);
      out.push(...j.records.map(rec=>mapBike(rec.fields, rec.id)));
      offset=j.offset;
    } while(offset);
  }catch(e){ console.warn('⚠  No se pudieron leer Vendidas/Reservadas:', e.message); return []; }
  return out;
}

// Slugs de bicis con una visita agendada futura (tabla Reservas). Sólo lee
// slug + fecha + estado (nunca datos personales). Si la tabla no existe o falla,
// devuelve un set vacío: el aviso de "reservada" simplemente no aparece.
async function fetchReservedSlugs(){
  if(!TOKEN) return new Set();
  const TABLE_R = process.env.AIRTABLE_RESERVAS_TABLE || 'Reservas';
  const hoy = new Date().toISOString().slice(0,10);
  const terminal = new Set(['cancelada','vencida','atendida','no asistió','no asistio']);
  const set = new Set();
  try{
    let offset;
    do{
      const u=new URL(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE_R)}`);
      ['Modelos Slug','Fecha','Estado'].forEach(f=>u.searchParams.append('fields[]', f));
      if(offset) u.searchParams.set('offset', offset);
      const r=await fetch(u,{headers:{Authorization:`Bearer ${TOKEN}`}});
      if(!r.ok){
        if(r.status===404||r.status===403){ console.warn(`ℹ  Reservas no accesible (${r.status}) — sin avisos de reserva.`); return new Set(); }
        throw new Error(`Reservas ${r.status}`);
      }
      const j=await r.json();
      for(const rec of j.records){
        const f=rec.fields;
        if(terminal.has(String(f['Estado']||'').toLowerCase().trim())) continue;
        if(f['Fecha'] && String(f['Fecha']).slice(0,10) < hoy) continue;   // visita ya pasó
        String(f['Modelos Slug']||'').split(/[\n,]/).map(s=>s.trim()).filter(Boolean).forEach(s=>set.add(s));
      }
      offset=j.offset;
    } while(offset);
  }catch(e){ console.warn('⚠  No se pudieron leer Reservas:', e.message); return new Set(); }
  return set;
}

/* ---------- sitio: constantes ---------- */
const SITE = (process.env.SITE_URL || 'https://biketrust-sitio.pages.dev').replace(/\/$/,'');
const SITE_DESC = 'Bicicletas Specialized usadas, premium y certificadas en Santiago. Cada bici inspeccionada multipunto, con diagnóstico honesto y garantía. La confianza de comprar usado, sin el riesgo.';
const absUrl = p => /^https?:\/\//.test(p) ? p : SITE + (String(p).startsWith('/') ? p : '/'+p);

const WA_NUM = '56985232895';                  // WhatsApp tienda
const wa = msg => `https://wa.me/${WA_NUM}?text=${encodeURIComponent(msg)}`;

// ── Mensajes de WhatsApp por tipo de entrada (copys del rediseño) ──
const WA_GENERAL   = wa('Hola! Busco una Specialized usada certificada.');
const WA_ASESORIA  = wa('Hola! No sé qué bici me sirve. ¿Me ayudan a elegir?');
const WA_PARTEPAGO = wa('Hola! Quiero dejar mi bici actual en parte de pago.');
const WA_CONSIGNA  = wa('Hola! Quiero consignar mi Specialized.');
const WA_CERT      = wa('Hola! Tengo dudas sobre la certificación de una bici.');
const WA_GUIAS     = wa('Hola! Tengo una duda antes de comprar.');
// Ficha de una bici concreta: modelo + talla + referencia (si existen).
function waFicha(b){
  let m = 'Hola! Quiero recibir la ficha certificada de la Specialized ' + b.modelo;
  if(b.talla) m += ' talla ' + b.talla;
  if(b.referencia) m += ' (ref ' + b.referencia + ')';
  return wa(m + '.');
}
const encargoHref = b => '/encargo' + (b && b.modelo ? '?modelo=' + encodeURIComponent(b.modelo) : '');

// Testimonios del diseño: APAGADOS hasta confirmar que son clientes reales
// (los modelos citados siguen en vitrina). Poner en true para publicarlos.
const TESTIMONIOS_ON = false;

// Línea «meta» de una bici: MTB · Eléctrica · Talla S3 · 2022
const metaLine = b => [b.disciplina, b.electrica?'Eléctrica':null, b.talla?'Talla '+b.talla:null, b.anio||null]
  .filter(Boolean).join(' · ');

/* ---------- CSS (identidad del rediseño «certificadas 3») ---------- */
const CSS = `
:root{--bg:#FBF8F1;--panel:#FFFEFA;--crema:#F5EFE3;--dark:#16120D;--ink:#191512;--text:#4A443C;--text2:#33302B;--muted:#8A8074;--meta:#96876F;--bronce:#96744A;--bronce2:#AF8958;--bronce3:#C9AE87;--linea:#E6DFD1;--linea2:#EDE6D8;--linea3:#E0D7C4;--input:#D8CFBC;--darkline:#2B251C;--darktext:#CFC5B4;--darkmut:#9C9080;--darkmut2:#8F8065;--darkdeep:#6E6355;--vend:#5C5346;--verde:#7E9271;--ph1:#F3EDDF;--ph2:#EEE6D4;--imgbg:#F1EBDD;--serif:'Cormorant Garamond',Georgia,serif;--sans:Archivo,system-ui,sans-serif;--mono:'IBM Plex Mono',ui-monospace,monospace}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:var(--bronce)}a:hover{color:var(--ink)}
::selection{background:var(--bronce2);color:#FFFDF8}
img{max-width:100%}
button{font-family:var(--sans)}
.wrap{max-width:1160px;margin:0 auto;padding:0 28px;width:100%}
.kicker{font-size:11px;font-weight:600;letter-spacing:.3em;text-transform:uppercase;color:var(--bronce)}
.kicker.gold{color:var(--bronce2)}
.mono{font-family:var(--mono)}
.h-serif{font-family:var(--serif);font-weight:500}
@keyframes bt-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes bt-draw{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes bt-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
@keyframes bt-modal-in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}

/* ── header ── */
.hd{position:sticky;top:0;z-index:60;font-family:var(--sans)}
.hd-top{background:var(--dark);color:#B9A582;display:flex;justify-content:space-between;gap:16px;padding:8px 28px;font-size:10px;letter-spacing:.22em;text-transform:uppercase;font-weight:500}
.hd-top .r{color:var(--darkmut2)}
.hd-bar{background:rgba(251,248,241,.94);backdrop-filter:blur(10px);border-bottom:1px solid var(--linea);display:flex;align-items:center;justify-content:space-between;gap:20px;padding:14px 28px;position:relative}
.hd-logo{display:flex;align-items:center;gap:12px;text-decoration:none;color:var(--ink)}
.hd-logo img{height:40px;width:auto;display:block}
.hd-logo .tx{display:flex;flex-direction:column;line-height:1}
.hd-logo .tx b{font-family:var(--serif);font-weight:600;font-size:21px;letter-spacing:.14em;color:var(--ink)}
.hd-logo .tx i{font-style:normal;font-size:9.5px;font-weight:600;letter-spacing:.5em;color:var(--bronce);margin-top:3px}
.hd-nav{display:flex;align-items:center;gap:28px}
.hd-nav a{text-decoration:none;font-size:11.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:#45403A;border-bottom:1px solid transparent;padding-bottom:4px}
.hd-nav a:hover{color:var(--bronce)}
.hd-nav a.on{color:var(--bronce);border-bottom-color:var(--bronce2)}
.hd-wa{text-decoration:none;background:var(--ink);color:#F5EFE3;font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;padding:11px 20px;display:inline-flex;align-items:center;gap:8px;white-space:nowrap}
.hd-wa:hover{background:var(--bronce);color:#FFFDF8}
.hd-burger{display:none;background:none;border:1px solid var(--input);padding:12px 14px;cursor:pointer;flex-direction:column;gap:5px}
.hd-burger span{display:block;width:20px;height:1.5px;background:var(--ink)}
.hd-panel{display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg);border-bottom:1px solid var(--linea);box-shadow:0 24px 48px rgba(25,21,18,.12);padding:8px 28px 24px;flex-direction:column}
.hd-panel a{text-decoration:none;font-size:13px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:#45403A;padding:16px 0;border-bottom:1px solid var(--linea2)}
.hd-panel a.on{color:var(--bronce)}
.hd-panel .wa{background:var(--ink);color:#F5EFE3;font-size:12px;padding:14px 20px;text-align:center;margin-top:20px;border-bottom:none}
@media (max-width:920px){
  .hd-top,.hd-nav,.hd-wa{display:none}
  .hd-burger{display:flex}
  .hd.open .hd-panel{display:flex}
}

/* ── footer ── */
.ft{background:var(--dark);color:var(--darktext);margin-top:96px}
.ft .grid{max-width:1160px;margin:0 auto;padding:64px 28px 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:44px}
.ft .lg{display:flex;align-items:center;gap:12px}
.ft .lg img{height:44px;width:auto;display:block}
.ft .lg .tx{display:flex;flex-direction:column;line-height:1}
.ft .lg b{font-family:var(--serif);font-weight:600;font-size:22px;letter-spacing:.14em;color:#F5EFE3}
.ft .lg i{font-style:normal;font-size:10px;font-weight:600;letter-spacing:.5em;color:var(--bronce2);margin-top:3px}
.ft .tag{margin:18px 0 0;font-size:13.5px;line-height:1.7;color:var(--darkmut);max-width:240px}
.ft .dom{margin:16px 0 0;font-family:var(--mono);font-size:11px;letter-spacing:.18em;color:var(--darkdeep)}
.ft h4{margin:0 0 18px;font-size:10.5px;font-weight:600;letter-spacing:.28em;text-transform:uppercase;color:var(--bronce2)}
.ft .col{display:flex;flex-direction:column;gap:12px;font-size:13.5px}
.ft .col a{color:#DED4C2;text-decoration:none}
.ft .col a:hover{color:var(--bronce2)}
.ft .col span{color:#DED4C2}
.ft .legal{max-width:1160px;margin:56px auto 0;padding:20px 28px;border-top:1px solid var(--darkline);display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--darkdeep)}
.ft .legal .r{color:var(--darkmut2)}

/* ── botones ── */
.btn-dark{text-decoration:none;display:inline-block;background:var(--ink);color:#F5EFE3;font-size:11.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;padding:16px 28px;border:none;cursor:pointer;text-align:center}
.btn-dark:hover{background:var(--bronce);color:#FFFDF8}
.btn-gold{text-decoration:none;display:inline-block;background:var(--bronce2);color:var(--dark);font-size:11.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;padding:16px 26px;border:none;cursor:pointer;text-align:center}
.btn-gold:hover{background:var(--bronce3);color:var(--dark)}
.btn-linegold{text-decoration:none;display:inline-flex;align-items:center;gap:10px;border:1px solid var(--bronce2);color:#E8DCC6;font-size:11.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;padding:15px 26px;background:none;cursor:pointer}
.btn-linegold:hover{background:var(--bronce2);color:var(--dark)}
.lnk{text-decoration:none;font-size:11px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--bronce);border-bottom:1px solid var(--bronce2);padding-bottom:4px}
.lnk:hover{color:var(--ink)}

/* ── card de bici ── */
.bc{display:block;text-decoration:none;color:var(--ink);background:var(--panel);border:1px solid var(--linea);font-family:var(--sans);transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease;height:100%}
.bc:hover{transform:translateY(-3px);border-color:var(--bronce3);box-shadow:0 18px 40px rgba(25,21,18,.09);color:var(--ink)}
.bc-img{position:relative;aspect-ratio:4/3;background:var(--imgbg);overflow:hidden}
.bc-img img{width:100%;height:100%;object-fit:cover;display:block}
.bc-ph{position:absolute;inset:0;background:repeating-linear-gradient(-45deg,var(--ph1) 0 14px,var(--ph2) 14px 28px);display:flex;align-items:center;justify-content:center}
.bc-ph span{font-family:var(--mono);font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:#A4977F;background:var(--bg);border:1px solid var(--linea3);padding:7px 12px}
.bc-chip{position:absolute;top:12px;left:12px;background:var(--dark);color:#F5EFE3;font-size:9.5px;font-weight:600;letter-spacing:.24em;text-transform:uppercase;padding:6px 11px}
.bc.is-vendida{opacity:.55}
.bc.is-vendida .bc-img img{filter:grayscale(1) contrast(.92)}
.bc.is-vendida .bc-chip{background:var(--vend)}
.bc.is-vendida .bc-p{color:var(--muted)}
.bc-body{padding:18px 20px 20px}
.bc-meta{margin:0;font-size:10px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--meta);min-height:12px}
.bc-name{margin:7px 0 0;font-family:var(--serif);font-weight:600;font-size:25px;line-height:1.1;color:var(--ink)}
.bc-price{display:flex;align-items:baseline;gap:10px;margin-top:9px}
.bc-p{font-size:16.5px;font-weight:600;letter-spacing:.01em;color:var(--ink)}
.bc-pa{font-size:12.5px;color:#A4977F;text-decoration:line-through}
.bc-foot{display:flex;align-items:center;gap:8px;margin-top:14px;padding-top:13px;border-top:1px solid var(--linea2)}
.bc-foot img{height:14px;width:auto}
.bc-cert{font-size:10px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--bronce)}
.bc-est{margin-left:auto;font-size:10px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--verde)}
.bc-est.visita{color:var(--bronce)}

/* ── hero portada ── */
.hero{position:relative;background:var(--bg);overflow:hidden}
.hero>.shadowlogo{position:absolute;left:-70px;bottom:-110px;height:400px;opacity:.05;pointer-events:none;z-index:0}
.hero-in{position:relative;z-index:1;display:flex;flex-wrap:wrap;align-items:stretch}
.hero-txt{flex:1 1 440px;min-width:min(100%,440px);max-width:720px;order:1;display:flex;flex-direction:column;justify-content:center;padding:56px 44px 64px max(28px,calc((100vw - 1200px)/2 + 28px))}
.hero-txt .k{animation:bt-rise .5s ease both}
.hero h1{margin:22px 0 0;font-family:var(--serif);font-weight:500;font-size:clamp(42px,4.8vw,70px);line-height:1.04;letter-spacing:-.01em;text-wrap:balance}
.hero h1 span{display:inline-block;animation:bt-rise .6s ease both}
.hero h1 .l2{animation-delay:.22s}
.hero h1 em{display:inline-block;font-style:italic;color:var(--bronce);animation:bt-rise .6s ease .34s both}
.hero .rule{display:block;width:68px;height:2px;background:var(--bronce2);margin-top:26px;transform-origin:left;animation:bt-draw .7s cubic-bezier(.22,1,.36,1) .5s both}
.hero .sub{margin:22px 0 0;font-size:16px;line-height:1.7;color:var(--text);max-width:44ch;animation:bt-rise .6s ease .45s both}
.hero .ctas{display:flex;flex-wrap:wrap;align-items:center;gap:18px;margin-top:32px;animation:bt-rise .6s ease .58s both}
.hero .dir{margin:30px 0 0;font-family:var(--mono);font-size:11px;letter-spacing:.16em;color:var(--meta);animation:bt-rise .6s ease .68s both}
.hero-visual{flex:1.25 1 520px;min-width:min(100%,520px);order:2;position:relative;min-height:clamp(430px,54vw,660px);background:var(--imgbg)}
.hv-float{position:absolute;inset:0;animation:bt-float 8s ease-in-out infinite}
.hv-layer{position:absolute;inset:0;display:block;opacity:0;transition:opacity .9s ease;pointer-events:none;text-decoration:none}
.hv-layer.on{opacity:1;pointer-events:auto}
.hv-layer .img{width:100%;height:100%;background-size:cover;background-position:center 56%}
.hv-layer .noimg{position:absolute;inset:0;background:repeating-linear-gradient(-45deg,var(--ph1) 0 16px,var(--ph2) 16px 32px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px}
.hv-layer .noimg .m{font-family:var(--serif);font-weight:600;font-size:clamp(30px,4vw,46px);color:#D9CBB0}
.hv-layer .noimg .t{font-family:var(--mono);font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:#A4977F;background:var(--bg);border:1px solid var(--linea3);padding:8px 14px}
.hero-chip{position:absolute;left:clamp(14px,2.4vw,26px);bottom:clamp(14px,2.4vw,26px);z-index:3;width:min(320px,calc(100% - 92px));background:rgba(255,254,250,.96);backdrop-filter:blur(6px);border:1px solid var(--bronce3);box-shadow:0 20px 44px rgba(25,21,18,.14)}
.hero-chip .top{text-decoration:none;color:var(--ink);display:block;padding:16px 18px 12px}
.hero-chip .r1{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.hero-chip .mod{font-family:var(--serif);font-weight:600;font-size:23px;line-height:1.05}
.hero-chip .tal{font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--meta);white-space:nowrap}
.hero-chip .r2{display:flex;align-items:center;gap:10px;margin-top:6px}
.hero-chip .pr{font-size:15px;font-weight:600}
.hero-chip .pa{font-size:11.5px;color:#A4977F;text-decoration:line-through}
.hero-chip .score{border-top:1px solid var(--linea2);padding:12px 18px 8px;display:flex;align-items:center;gap:11px}
.hero-chip .score img{height:26px;width:auto}
.hero-chip .sn{font-family:var(--serif);font-weight:600;font-size:30px;line-height:1}
.hero-chip .sn small{font-size:.5em;color:var(--bronce2);font-weight:600}
.hero-chip .sl{font-size:8.5px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--meta);line-height:1.5}
.hero-chip .bars{padding:4px 18px 14px;display:flex;flex-direction:column;gap:7px}
.hero-chip .bar .t{display:flex;justify-content:space-between;gap:10px}
.hero-chip .bar .lb{font-size:9px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.hero-chip .bar .vl{font-family:var(--mono);font-size:9.5px;color:var(--ink)}
.hero-chip .bar .tr{display:block;height:2px;background:#EFE8D9;margin-top:3px}
.hero-chip .bar .fl{display:block;height:2px;background:var(--bronce2);transform-origin:left;transform:scaleX(0);transition:transform .65s cubic-bezier(.22,1,.36,1)}
.hero-chip .vf{text-decoration:none;margin:5px 0 0;font-size:9.5px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--bronce);display:inline-block}
.hero-dots{position:absolute;right:clamp(14px,2.4vw,26px);bottom:clamp(16px,2.4vw,28px);z-index:3;display:flex;gap:7px}
.hero-dots button{cursor:pointer;border:none;padding:6px 0;background:none;display:block}
.hero-dots button span{display:block;width:24px;height:3px;background:rgba(25,21,18,.22);transition:background .3s}
.hero-dots button.on span{background:var(--bronce2)}
@media (max-width:920px){ .hero-txt{order:2} .hero-visual{order:1} }

/* ── secciones compartidas ── */
.sec-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:14px}
.sec-head h2{margin:12px 0 0;font-family:var(--serif);font-weight:500;font-size:clamp(28px,3.4vw,40px)}
.band-dark{background:var(--dark);color:var(--darktext);padding:clamp(22px,3vw,30px) clamp(22px,3vw,34px);display:flex;flex-wrap:wrap;align-items:center;gap:18px 26px}
.band-dark .bd-k{margin:0;font-family:var(--mono);font-size:10px;letter-spacing:.24em;color:var(--bronce2)}
.band-dark .bd-t{margin:8px 0 0;font-family:var(--serif);font-weight:600;font-size:clamp(22px,2.6vw,30px);color:#F5EFE3}
.band-dark .bd-s{margin:6px 0 0;font-size:13px;line-height:1.6;color:var(--darkmut)}
.band-dark .bd-r{font-family:var(--mono);font-size:10px;letter-spacing:.18em;color:var(--muted)}

/* ── sticky móvil (WhatsApp) ── */
.msticky{display:none}
.msticky-space{height:0}
@media (max-width:920px){
  .msticky{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:70;background:var(--dark);align-items:center;gap:12px;padding:11px 16px;box-shadow:0 -12px 30px rgba(25,21,18,.25)}
  .msticky img{height:28px;width:auto}
  .msticky .info{display:flex;flex-direction:column;line-height:1.2;min-width:0}
  .msticky .info .p{font-family:var(--serif);font-weight:600;font-size:20px;color:#F5EFE3}
  .msticky .info .c{font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--bronce2)}
  .msticky a.cta{text-decoration:none;flex:1;background:var(--bronce2);color:var(--dark);font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:15px 12px;text-align:center}
  .msticky-space{height:78px}
}

/* ── catálogo ── */
.cat-head{border-bottom:1px solid var(--ink);padding-bottom:28px;display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px}
.cat-head h1{margin:14px 0 0;font-family:var(--serif);font-weight:500;font-size:clamp(38px,5vw,60px);line-height:1.05}
.cat-head .n{margin:0;font-family:var(--mono);font-size:11px;letter-spacing:.16em;color:var(--meta)}
.filters{display:flex;flex-wrap:wrap;align-items:center;gap:14px}
.fchips{display:flex;flex-wrap:wrap;gap:8px}
.fchip{cursor:pointer;font-size:10.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;padding:10px 16px;border:1px solid var(--input);background:var(--panel);color:#45403A}
.fchip:hover{border-color:var(--bronce2)}
.fchip.on{background:var(--ink);color:#F5EFE3;border-color:var(--ink)}
.fsels{display:flex;flex-wrap:wrap;gap:10px;margin-left:auto}
.fsel{font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;padding:10px 12px;border:1px solid var(--input);background:var(--panel);color:var(--ink);cursor:pointer}
.fbar{display:flex;align-items:center;gap:14px;margin-top:18px;border-top:1px solid var(--linea2);padding-top:14px}
.fbar .res{font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--meta)}
.fclear{cursor:pointer;background:none;border:none;font-size:10.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--bronce);padding:0;border-bottom:1px solid var(--bronce2)}
.cat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(255px,1fr));gap:20px}
.cat-empty{border:1px dashed var(--bronce3);background:var(--panel);padding:56px 28px;text-align:center}
.cat-empty .m{margin:0;font-family:var(--mono);font-size:11px;letter-spacing:.2em;color:var(--meta)}
.cat-empty h3{margin:14px auto 0;font-family:var(--serif);font-weight:600;font-size:32px;max-width:22ch}
.cat-empty p{margin:12px auto 0;font-size:14px;line-height:1.7;color:var(--text);max-width:48ch}
.enc-band{background:var(--crema);border:1px solid var(--linea3);padding:clamp(32px,5vw,52px);display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:24px}
.enc-band h2{margin:12px 0 0;font-family:var(--serif);font-weight:500;font-size:clamp(26px,3.4vw,38px);line-height:1.15;max-width:24ch}
.enc-band p{margin:12px 0 0;font-size:14px;line-height:1.7;color:var(--text);max-width:52ch}

/* ── ficha ── */
.vend-banner{background:var(--dark);color:var(--darktext);padding:16px 28px;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px 22px;text-align:center}
.vend-banner .k{font-size:10.5px;font-weight:600;letter-spacing:.28em;text-transform:uppercase;color:var(--bronce2)}
.vend-banner .t{font-size:13.5px;color:#DED4C2}
.vend-banner a{text-decoration:none;font-size:10.5px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:#E8DCC6;border:1px solid var(--bronce2);padding:9px 16px}
.vend-banner a:hover{background:var(--bronce2);color:var(--dark)}
.crumbs{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px}
.crumbs a{text-decoration:none;font-size:11px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--meta)}
.crumbs a:hover{color:var(--bronce)}
.crumbs .n{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;color:var(--meta)}
.f-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:44px;align-items:start}
.pgal .frame{background:var(--panel);border:1px solid var(--linea3);padding:10px}
.pgal .main{aspect-ratio:4/4.2;overflow:hidden;background:var(--imgbg)}
.pgal .main img{width:100%;height:100%;object-fit:cover;display:block}
.pgal.is-vendida .main img{filter:grayscale(1) contrast(.92)}
.pgal .thumbs{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:10px}
.pgal .th{cursor:pointer;padding:4px;background:var(--panel);border:1px solid var(--linea3);display:block}
.pgal .th:hover{border-color:var(--bronce2)}
.pgal .th.on{border-color:var(--bronce2)}
.pgal .th span{display:block;aspect-ratio:1/1;overflow:hidden;background:var(--imgbg)}
.pgal .th img{width:100%;height:100%;object-fit:cover;display:block;opacity:.75}
.pgal .th.on img{opacity:1}
.pgal .cap{margin:12px 0 0;font-family:var(--mono);font-size:10px;letter-spacing:.16em;color:var(--meta)}
.pgal-ph{border:1px solid var(--linea3);background:repeating-linear-gradient(-45deg,var(--ph1) 0 14px,var(--ph2) 14px 28px);aspect-ratio:4/3.4;display:flex;align-items:center;justify-content:center;padding:20px}
.pgal-ph span{font-family:var(--mono);font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:#A4977F;background:var(--bg);border:1px solid var(--linea3);padding:10px 16px;text-align:center}
.f-info .meta{margin:0;font-size:11px;font-weight:600;letter-spacing:.28em;text-transform:uppercase;color:var(--bronce);min-height:13px}
.f-info h1{margin:12px 0 0;font-family:var(--serif);font-weight:500;font-size:clamp(40px,4.6vw,58px);line-height:1.02}
.f-info h1 .marca{display:block;font-size:.44em;letter-spacing:.22em;font-weight:600;color:var(--muted);margin-bottom:6px}
.f-info .fitline{margin:14px 0 0;font-family:var(--mono);font-size:11.5px;letter-spacing:.14em;color:var(--text)}
.f-info .resumen{margin:16px 0 0;font-size:14.5px;line-height:1.7;color:var(--text);max-width:52ch}
.f-price{display:flex;flex-wrap:wrap;align-items:baseline;gap:14px;margin-top:22px;border-top:1px solid var(--linea);padding-top:20px}
.f-price .p{font-family:var(--serif);font-weight:600;font-size:42px;color:var(--ink)}
.f-price .p.muted{color:var(--muted)}
.f-price .pa{font-size:15px;color:#A4977F;text-decoration:line-through}
.f-price .chip{background:var(--dark);color:#F5EFE3;font-size:9.5px;font-weight:600;letter-spacing:.24em;text-transform:uppercase;padding:7px 12px}
.f-price .chip.vend{background:var(--vend)}
.f-nota{margin:10px 0 0;font-size:12.5px;color:var(--muted)}
.f-nota b{color:var(--bronce)}
.buybox{margin-top:26px;background:var(--dark);padding:22px 22px 18px}
.buybox .k{margin:0 0 14px;font-size:10px;font-weight:600;letter-spacing:.28em;text-transform:uppercase;color:var(--bronce2)}
.buybox .btn-gold{display:block;width:100%;padding:17px 20px;font-size:12px}
.buybox .agendar{display:block;width:100%;cursor:pointer;margin-top:10px;background:none;border:1px solid var(--vend);color:var(--darktext);font-size:10.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;padding:14px 20px}
.buybox .agendar:hover{border-color:var(--bronce2);color:#E8DCC6}
.buybox .cap{margin:14px 0 0;font-size:12px;line-height:1.6;color:var(--darkmut)}
.f-cert-mini{display:flex;align-items:center;gap:10px;margin-top:26px;border:1px solid var(--linea);background:var(--crema);padding:13px 16px}
.f-cert-mini img{height:18px;width:auto}
.f-cert-mini .c{font-size:10.5px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--bronce)}
.f-cert-mini a{margin-left:auto;text-decoration:none;font-size:10px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.f-cert-mini a:hover{color:var(--bronce)}
.certbox{background:var(--panel);border:1px solid var(--bronce3)}
.certbox .hd2{display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;padding:18px 28px;border-bottom:1px solid var(--linea2)}
.certbox .hd2 .l{font-size:10.5px;font-weight:600;letter-spacing:.3em;text-transform:uppercase;color:var(--bronce)}
.certbox .hd2 .r{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;color:var(--meta)}
.certbox .bd{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:36px;padding:36px 28px;align-items:center}
.certbox .big{text-align:center}
.certbox .big .n{font-family:var(--serif);font-weight:500;font-size:clamp(96px,11vw,130px);line-height:.9;color:var(--ink)}
.certbox .big .n small{font-size:.32em;color:var(--bronce2);font-weight:600}
.certbox .big .sello{display:flex;align-items:center;justify-content:center;gap:9px;margin-top:18px}
.certbox .big .sello img{height:20px;width:auto}
.certbox .big .sello span{font-size:10.5px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--text)}
.certbox .desg .k{margin:0 0 6px;font-size:10.5px;font-weight:600;letter-spacing:.24em;text-transform:uppercase;color:var(--meta)}
.certbox .row{display:flex;align-items:center;gap:16px;padding:13px 0;border-bottom:1px solid var(--linea2)}
.certbox .row .lb{font-size:13.5px;color:var(--ink);flex:0 0 44%}
.certbox .row .tr{flex:1;height:3px;background:#EFE8D9;position:relative;display:block}
.certbox .row .fl{position:absolute;inset:0 auto 0 0;background:var(--bronce2);display:block}
.certbox .row .vl{font-family:var(--mono);font-size:12px;color:var(--ink);flex:0 0 44px;text-align:right}
.certbox .foot2{display:flex;justify-content:space-between;gap:10px;margin-top:14px}
.certbox .foot2 a{text-decoration:none;font-size:10.5px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--bronce)}
.certbox .foot2 .d{font-family:var(--mono);font-size:10px;letter-spacing:.14em;color:var(--meta)}
.diag3{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:1px;background:var(--linea3);border:1px solid var(--linea3)}
.diag3>div{background:var(--crema);padding:26px 24px;text-align:center}
.diag3 .l{margin:0;font-family:var(--mono);font-size:10px;letter-spacing:.24em;color:var(--meta)}
.diag3 .v{margin:10px 0 0;font-family:var(--serif);font-weight:500;font-size:52px;line-height:1}
.diag3 .v small{font-size:.4em;color:var(--bronce)}
.diag-note{margin:14px 0 0;text-align:center;font-family:var(--mono);font-size:10.5px;letter-spacing:.2em;color:var(--bronce)}
.hon-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}
.hon-card{border:1px solid var(--linea3);background:var(--crema);padding:30px 28px}
.hon-card .k{margin:0;font-size:10.5px;font-weight:600;letter-spacing:.28em;text-transform:uppercase;color:var(--bronce)}
.hon-card .q{margin:12px 0 0;color:var(--muted);font-style:italic;font-family:var(--serif);font-size:17px}
.hon-card .it{margin:14px 0 0;font-size:13.5px;line-height:1.65;color:var(--ink);border-bottom:1px solid var(--linea);padding-bottom:13px;display:flex;gap:12px}
.hon-card .it:last-child{border-bottom:none;padding-bottom:0}
.hon-card .it .n{font-family:var(--mono);font-size:11px;color:var(--meta);flex:0 0 auto;padding-top:2px}
.specs .tabs{display:flex;gap:26px;border-bottom:1px solid var(--linea3);margin-top:18px}
.specs .tabbtn{cursor:pointer;background:none;border:none;border-bottom:2px solid transparent;color:var(--muted);font-size:11.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;padding:12px 2px;margin-bottom:-1px}
.specs .tabbtn:hover{color:var(--bronce)}
.specs .tabbtn.on{color:var(--ink);border-bottom-color:var(--bronce2)}
.specs .panel{max-width:760px;display:none}
.specs .panel.on{display:block}
.specs .prow{display:flex;justify-content:space-between;gap:24px;padding:14px 0;border-bottom:1px solid var(--linea2)}
.specs .prow .k{font-size:13px;color:var(--muted);flex:0 0 38%}
.specs .prow .v{font-size:13.5px;color:var(--ink);text-align:right}
.compacta{border:1px dashed var(--bronce3);background:var(--panel);padding:40px 28px;text-align:center}
.compacta .m{margin:0;font-family:var(--mono);font-size:10.5px;letter-spacing:.2em;color:var(--meta)}
.compacta p{margin:12px auto 0;font-size:14px;line-height:1.7;color:var(--text);max-width:52ch}
.disp-strip{border-top:2px solid var(--ink);border-bottom:1px solid var(--linea3);padding:16px 2px;display:flex;flex-wrap:wrap;align-items:center;gap:10px 26px;font-family:var(--mono);font-size:11px;letter-spacing:.16em;color:var(--ink)}
.disp-strip .dot{display:inline-flex;align-items:center;gap:9px}
.disp-strip .dot i{width:8px;height:8px;border-radius:50%;background:var(--bronce2);display:inline-block}
.disp-strip .sep{color:var(--input)}
.cta2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:20px}
.cta2 .dark{background:var(--dark);color:var(--darktext);padding:clamp(28px,4vw,44px);display:flex;flex-direction:column}
.cta2 .dark .k{margin:0;font-size:10.5px;font-weight:600;letter-spacing:.28em;text-transform:uppercase;color:var(--bronce2)}
.cta2 .dark h2{margin:14px 0 0;font-family:var(--serif);font-weight:500;font-size:clamp(26px,3vw,36px);color:#F5EFE3;line-height:1.15}
.cta2 .dark p{margin:12px 0 0;font-size:13px;line-height:1.65;color:var(--darkmut);max-width:46ch}
.cta2 .dark .btn-gold{margin-top:24px}
.cta2 .dark .agendar{cursor:pointer;margin-top:12px;background:none;border:1px solid var(--vend);color:var(--darktext);font-size:10.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;padding:13px 20px}
.cta2 .dark .agendar:hover{border-color:var(--bronce2);color:#E8DCC6}
.cta2 .lite{background:var(--crema);border:1px solid var(--linea3);padding:clamp(28px,4vw,44px);display:flex;flex-direction:column}
.cta2 .lite .k{margin:0;font-size:10.5px;font-weight:600;letter-spacing:.28em;text-transform:uppercase;color:var(--bronce)}
.cta2 .lite h2{margin:14px 0 0;font-family:var(--serif);font-weight:500;font-size:clamp(26px,3vw,36px);line-height:1.15}
.cta2 .lite p{margin:12px 0 0;font-size:13px;line-height:1.65;color:var(--text);max-width:46ch}
.cta2 .lite a{text-decoration:none;margin-top:auto;padding-top:24px;font-size:11px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--bronce)}
.cta2 .lite a:hover{color:var(--ink)}

/* ── modal reserva ── */
.rsv-ov{position:fixed;inset:0;z-index:100;display:none;align-items:center;justify-content:center;padding:18px}
.rsv-ov.open{display:flex}
.rsv-ov-bg{position:absolute;inset:0;background:rgba(22,18,13,.55);backdrop-filter:blur(3px)}
.rsv{position:relative;background:var(--bg);border:1px solid var(--bronce3);max-width:600px;width:100%;max-height:88vh;overflow:auto;animation:bt-modal-in .25s ease}
.rsv-hd{display:flex;justify-content:space-between;align-items:center;padding:20px 26px;border-bottom:1px solid var(--linea);position:sticky;top:0;background:var(--bg);z-index:2}
.rsv-stepn{margin:0;font-family:var(--mono);font-size:10px;letter-spacing:.22em;color:var(--bronce);text-transform:uppercase}
.rsv-ttl{margin:6px 0 0;font-family:var(--serif);font-weight:600;font-size:24px}
.rsv-x{cursor:pointer;background:none;border:1px solid var(--input);color:var(--text);font-size:16px;line-height:1;padding:9px 13px}
.rsv-x:hover{border-color:var(--bronce2);color:var(--bronce)}
.rsv-bd{padding:24px 26px 28px}
.rsv-intro{margin:0 0 18px;font-size:13px;line-height:1.6;color:var(--text)}
.rsv-step{display:none}
.rsv-step.on{display:block}
.rsv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
.rsv-lbl{display:flex;flex-direction:column;gap:7px;font-size:10.5px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--meta)}
.rsv-lbl input,.rsv-lbl select{font-family:var(--sans);font-size:14px;padding:12px;border:1px solid var(--input);background:var(--panel);color:var(--ink);width:100%}
.rsv-sub{margin:22px 0 10px;font-size:10.5px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--meta)}
.rsv-note{margin:0 0 10px;font-size:12px;color:var(--muted)}
.rsv-models{display:flex;flex-wrap:wrap;gap:8px}
.rsv-model{cursor:pointer;font-size:11px;padding:9px 13px;border:1px solid var(--input);background:var(--panel);color:#45403A;letter-spacing:.04em;display:inline-flex;align-items:center;user-select:none}
.rsv-model:hover{border-color:var(--bronce2)}
.rsv-model input{position:absolute;opacity:0;pointer-events:none}
.rsv-model.sel{background:var(--ink);color:#F5EFE3;border-color:var(--ink)}
.rsv-model.dis{opacity:.45;cursor:not-allowed}
.rsv-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-top:14px}
.rsv-field{margin-top:14px}
.rsv-err{margin-top:14px;font-size:12.5px;color:#8C3B2E;background:#F7E8E2;border:1px solid #E3C0B4;padding:10px 12px}
.rsv-ft{display:flex;justify-content:space-between;gap:12px;padding:0 26px 26px}
.rsv-btn{cursor:pointer;background:var(--ink);border:none;color:#F5EFE3;font-size:11.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;padding:15px 30px;margin-left:auto}
.rsv-btn:hover{background:var(--bronce)}
.rsv-btn.ghost{background:none;border:1px solid var(--input);color:var(--text);margin-left:0}
.rsv-btn.ghost:hover{border-color:var(--bronce2);color:var(--bronce)}
.rsv-ok{text-align:center;padding:20px 0 4px}
.rsv-ok img{height:44px;width:auto}
.rsv-ok h3{margin:18px 0 0;font-family:var(--serif);font-weight:600;font-size:30px}
.rsv-okmsg{margin:12px auto 0;font-size:13.5px;line-height:1.7;color:var(--text);max-width:40ch}
.rsv-wa{display:inline-block;margin-top:16px;background:var(--bronce2);color:var(--dark);text-decoration:none;font-size:11.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;padding:14px 24px}
.hidden{display:none!important}

/* ── páginas informativas ── */
.pg-hero{text-align:left}
.pg-hero h1{margin:18px 0 0;font-family:var(--serif);font-weight:500;font-size:clamp(40px,5.6vw,68px);line-height:1.05;max-width:16ch}
.pg-hero .lead{margin:20px 0 0;font-size:15.5px;line-height:1.7;color:var(--text);max-width:58ch}
.pg-hero .cite{margin:28px 0 0;font-family:var(--serif);font-style:italic;font-size:clamp(20px,2.4vw,26px);color:var(--bronce);border-top:1px solid var(--linea3);padding-top:22px;max-width:52ch}
.cards3{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}
.icard{background:var(--panel);border:1px solid var(--linea3);padding:30px 28px;display:flex;flex-direction:column}
.icard .n{font-family:var(--mono);font-size:11px;letter-spacing:.2em;color:var(--bronce2)}
.icard h3{margin:14px 0 0;font-family:var(--serif);font-weight:600;font-size:25px;line-height:1.15}
.icard p{margin:10px 0 0;font-size:13px;line-height:1.65;color:var(--text)}
.icard .fine{margin:auto 0 0;padding-top:14px;font-family:var(--mono);font-size:9.5px;letter-spacing:.16em;color:var(--meta)}
.icard .checks span{font-size:12.5px;color:var(--ink);padding:9px 0;border-top:1px solid var(--linea2);display:flex;gap:10px}
.icard .checks span:last-child{border-bottom:1px solid var(--linea2)}
.icard .checks i{font-style:normal;color:var(--bronce2)}
.darkpanel{background:var(--dark);color:var(--darktext);padding:clamp(36px,5.6vw,64px);position:relative;overflow:hidden}
.darkpanel .shadowlogo{position:absolute;right:-30px;top:-40px;height:240px;opacity:.12;pointer-events:none}
.darkpanel h2{margin:14px 0 0;font-family:var(--serif);font-weight:500;font-size:clamp(28px,4vw,46px);color:#F5EFE3;line-height:1.12;max-width:22ch}
.darkpanel p{margin:16px 0 0;font-size:14.5px;line-height:1.7;color:var(--darkmut);max-width:52ch}
.arow{display:flex;align-items:center;gap:16px;padding:15px 0;border-bottom:1px solid var(--darkline)}
.arow .id{font-family:var(--mono);font-size:10.5px;color:var(--darkdeep);flex:0 0 26px}
.arow .nm{font-size:14px;color:#DED4C2;flex:1}
.arow .dt{font-size:11.5px;color:var(--darkmut2)}
.guia-nav{display:flex;flex-direction:column;margin-top:28px;border-top:1px solid var(--ink)}
.guia-nav a{text-decoration:none;color:var(--ink);display:flex;gap:16px;align-items:baseline;padding:15px 2px;border-bottom:1px solid var(--linea2)}
.guia-nav a:hover{color:var(--bronce)}
.guia-nav .n{font-family:var(--mono);font-size:10.5px;color:var(--meta)}
.guia-nav .t{font-family:var(--serif);font-weight:600;font-size:21px}
.guia art{display:block}
.guia h2{margin:12px 0 0;font-family:var(--serif);font-weight:600;font-size:clamp(30px,4vw,42px);line-height:1.1}
.guia p.body{margin:16px 0 0;font-size:15px;line-height:1.85;color:var(--text2)}
.guia p.body.first{margin-top:22px}
.guia .box{border:1px solid var(--linea3);background:var(--crema);padding:22px 24px;margin-top:22px;display:flex;flex-direction:column;gap:13px}
.guia .box p{margin:0;font-size:14px;line-height:1.7;color:var(--ink)}
.guia .box p+p{border-top:1px solid var(--linea);padding-top:13px}
.formbox{background:var(--panel);border:1px solid var(--bronce3)}
.formbox .hd3{display:flex;justify-content:space-between;gap:10px;padding:18px 28px;border-bottom:1px solid var(--linea2)}
.formbox .hd3 .l{font-size:10.5px;font-weight:600;letter-spacing:.3em;text-transform:uppercase;color:var(--bronce)}
.formbox .hd3 .r{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;color:var(--meta)}
.formbox .bd3{padding:28px;display:flex;flex-direction:column;gap:18px}
.formbox label{display:flex;flex-direction:column;gap:8px;font-size:10.5px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--meta)}
.formbox input,.formbox select{font-family:var(--sans);font-size:15px;padding:14px;border:1px solid var(--input);background:var(--bg);color:var(--ink);width:100%;cursor:pointer}
.formbox input[type=text]{cursor:text}
.formbox .g2{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px}
.formbox .fine{margin:0;text-align:center;font-family:var(--mono);font-size:10px;letter-spacing:.2em;color:var(--meta)}
.figure3{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:20px;margin-top:22px}
.figure3 figure{margin:0}
.figure3 .ph{aspect-ratio:4/4.4;border:1px solid var(--linea3);background:repeating-linear-gradient(-45deg,var(--ph1) 0 14px,var(--ph2) 14px 28px);display:flex;align-items:center;justify-content:center;padding:16px}
.figure3 .ph span{font-family:var(--mono);font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;color:#A4977F;background:var(--bg);border:1px solid var(--linea3);padding:7px 11px;text-align:center}
.figure3 figcaption{margin-top:12px}
.figure3 .t1{display:block;font-size:13px;font-weight:600;color:var(--ink)}
.figure3 .t2{display:block;margin-top:3px;font-family:var(--mono);font-size:10px;letter-spacing:.16em;color:var(--meta)}
.strip3{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:14px}
.strip3 .card{border:1px solid var(--linea3);background:var(--bg);padding:22px 22px 18px;display:flex;flex-direction:column;min-height:190px}
.strip3 .n{font-family:var(--mono);font-size:10.5px;letter-spacing:.2em;color:var(--bronce2)}
.strip3 .t{margin:12px 0 0;font-family:var(--serif);font-weight:600;font-size:26px}
.strip3 .t small{color:var(--bronce);font-size:1em}
.strip3 .d{margin:8px 0 0;font-size:12.5px;line-height:1.6;color:var(--text)}
.strip3 .f{margin:auto 0 0;padding-top:14px;border-top:1px solid var(--linea2);font-family:var(--mono);font-size:10px;letter-spacing:.14em;color:var(--ink)}
.strip3 .f .gold{color:var(--bronce)}
.strip3 .f.script{font-family:var(--serif);font-style:italic;font-size:15px;color:var(--bronce);letter-spacing:0}
.steps3{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:clamp(20px,3vw,36px);margin-top:30px}
.steps3 .st{border-top:2px solid var(--ink);position:relative;padding-top:20px}
.steps3 .st i{position:absolute;top:-6px;left:0;width:10px;height:10px;background:var(--bronce2);border-radius:50%}
.steps3 .k{margin:0;font-family:var(--mono);font-size:10px;letter-spacing:.22em;color:var(--meta)}
.steps3 .big{margin:10px 0 0;font-family:var(--mono);font-size:clamp(30px,3.6vw,42px);color:var(--ink);letter-spacing:-.02em}
.steps3 .d{margin:8px 0 0;font-size:13.5px;line-height:1.6;color:var(--text)}
.vs{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:20px}
.vs .colA{border:1px solid var(--linea3);background:var(--crema);padding:clamp(26px,3.4vw,38px)}
.vs .colB{border:1px solid var(--bronce3);background:var(--panel);padding:clamp(26px,3.4vw,38px)}
.vs .k{margin:0;font-family:var(--mono);font-size:10px;letter-spacing:.22em;color:var(--meta)}
.vs .colB .k{color:var(--bronce)}
.vs h3{margin:10px 0 0;font-family:var(--serif);font-weight:500;font-size:clamp(24px,2.8vw,30px)}
.vs .colA h3{color:var(--vend)}
.vs .it{margin:14px 0 0;padding-bottom:14px;border-bottom:1px solid var(--linea);font-size:13.5px;line-height:1.6;display:flex;gap:12px}
.vs .it:first-of-type{margin-top:18px}
.vs .it:last-child{border-bottom:none;padding-bottom:0}
.vs .colA .it{color:#6B6156}
.vs .colA .it i{font-style:normal;color:#A4977F;flex:0 0 auto}
.vs .colB .it{color:var(--ink)}
.vs .colB .it i{font-style:normal;color:var(--bronce);font-weight:700;flex:0 0 auto}
.vs .hdr{display:flex;align-items:center;justify-content:space-between;gap:10px}
.vs .hdr img{height:20px;width:auto}
.reveal-init [data-reveal]{opacity:0;transform:translateY(16px);transition:opacity .3s ease,transform .3s ease}
`;

/* ---------- layout compartido ---------- */
// HEAD(titulo, { desc, path, image, type }) — path = URL canónica limpia (sin .html).
const HEAD = (t, o={}) => {
  const desc  = escA(o.desc || SITE_DESC);
  const url   = absUrl(o.path || '/');
  const image = absUrl(o.image || '/assets/img/hero-trail.jpg');
  const type  = o.type || 'website';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(t)}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="Bike Trust">
<meta property="og:locale" content="es_CL">
<meta property="og:title" content="${escA(t)}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escA(t)}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${image}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css"></head><body>`;
};

const NAV_JS = String.raw`(function(){
  var hd=document.querySelector('.hd'), b=document.querySelector('.hd-burger');
  if(hd&&b) b.addEventListener('click',function(){ hd.classList.toggle('open'); });
})();`;

// Header del rediseño. active: '' | 'catalogo' | 'encargo' | 'certificacion' | 'consigna' | 'guias'
function TOPBAR(active=''){
  const items = [
    ['Catálogo','/catalogo','catalogo'],
    ['Encargo','/encargo','encargo'],
    ['Cómo certificamos','/como-certificamos','certificacion'],
    ['Consigna','/consigna','consigna'],
    ['Guías','/guias','guias']
  ];
  const nav = k => items.map(([l,h,key])=>`<a href="${h}"${key===active?' class="on"':''}>${l}</a>`).join('');
  return `<header class="hd">
  <div class="hd-top"><span>Specialized usadas · Certificadas en Santiago</span><span class="r">Av. Las Condes 12461 · +56 9 8523 2895</span></div>
  <div class="hd-bar">
    <a class="hd-logo" href="/"><img src="/assets/brand/shield.png" alt="Bike Trust"><span class="tx"><b>BIKE</b><i>TRUST</i></span></a>
    <nav class="hd-nav">${nav()}</nav>
    <a class="hd-wa" href="${WA_GENERAL}" target="_blank" rel="noopener">WhatsApp <span style="font-size:13px">↗</span></a>
    <button type="button" class="hd-burger" aria-label="Menú"><span></span><span></span></button>
  </div>
  <div class="hd-panel">${nav()}<a class="wa" href="${WA_GENERAL}" target="_blank" rel="noopener">Escríbenos por WhatsApp ↗</a></div>
</header>`;
}

const FOOT = `<footer class="ft">
  <div class="grid">
    <div>
      <div class="lg"><img src="/assets/brand/shield.png" alt=""><span class="tx"><b>BIKE</b><i>TRUST</i></span></div>
      <p class="tag">Specialized usadas, certificadas por nuestro taller. La confianza de comprar usado, sin el riesgo.</p>
      <p class="dom">BIKETRUST.CL</p>
    </div>
    <div><h4>Explora</h4><div class="col">
      <a href="/catalogo">Catálogo</a>
      <a href="/encargo">Encargo de bicis</a>
      <a href="/como-certificamos">Cómo certificamos</a>
      <a href="/consigna">Consigna tu bici</a>
    </div></div>
    <div><h4>Aprende</h4><div class="col">
      <a href="/guias#diagnostico">Cómo leer el diagnóstico</a>
      <a href="/guias#electrica">Eléctrica o muscular</a>
      <a href="/guias#honesto">Qué es el estado honesto</a>
    </div></div>
    <div><h4>Visítanos</h4><div class="col">
      <span>Av. Las Condes 12461<br>Las Condes · Santiago de Chile</span>
      <a href="tel:+56985232895">+56 9 8523 2895</a>
      <a href="https://wa.me/${WA_NUM}" target="_blank" rel="noopener">WhatsApp ↗</a>
      <a href="https://instagram.com/biketrust.cl" target="_blank" rel="noopener">Instagram · @biketrust.cl</a>
    </div></div>
  </div>
  <div class="legal"><span>© 2026 Bike Trust · Santiago de Chile</span><span class="r">La confianza de comprar usado, sin el riesgo.</span></div>
</footer>
<script>${NAV_JS}</script></body></html>`;

// Barra fija móvil de WhatsApp (portada y páginas informativas).
const MSTICKY = `<div class="msticky-space"></div><div class="msticky"><img src="/assets/brand/shield.png" alt="">
  <a class="cta" href="${WA_GENERAL}" target="_blank" rel="noopener">Escríbenos por WhatsApp ↗</a></div>`;

// Favicon: el escudo de la marca, en bronce.
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 36"><path d="M4 6 Q4 3 7 3 H25 Q28 3 28 6 V20 Q28 23.5 25.4 25.2 L16 32 L6.6 25.2 Q4 23.5 4 20 Z" fill="#A88454"/></svg>`;

/* ---------- card de bici ---------- */
function cardHTML(b){
  const vend = esVendida(b), res = esReservada(b);
  const pj = fmtPuntaje(b.puntaje);
  const foto = b.fotos && b.fotos[0];
  const chip = vend ? 'Vendida' : (res ? 'Reservada' : null);
  const estLabel = (!vend && !res) ? (b.reservada ? 'Visita agendada' : 'Disponible') : '';
  const estCls = b.reservada ? 'bc-est visita' : 'bc-est';
  return `<a class="bc${vend?' is-vendida':''}" href="/bici/${esc(b.slug)}" data-disc="${escA(b.disciplina)}" data-talla="${escA(b.talla)}" data-precio="${b.precio??''}" data-estado="${vend?'vendida':(res?'reservada':'disponible')}">
  <div class="bc-img">
    ${foto ? `<img src="${esc(foto)}" alt="${escA('Specialized '+b.modelo)}" loading="lazy">`
           : `<div class="bc-ph"><span>${vend?'unidad vendida':'foto en preparación'}</span></div>`}
    ${chip ? `<span class="bc-chip">${chip}</span>` : ''}
  </div>
  <div class="bc-body">
    <p class="bc-meta">${esc(metaLine(b))}</p>
    <h3 class="bc-name">${esc(b.modelo)}</h3>
    <div class="bc-price"><span class="bc-p">${b.precio!=null?clp(b.precio):'—'}</span>${b.precioNuevo?`<span class="bc-pa">${clp(b.precioNuevo)}</span>`:''}</div>
    <div class="bc-foot">
      <img src="/assets/brand/shield.png" alt="">
      <span class="bc-cert">${pj?`Certificada · ${pj}/7`:'Certificada Bike Trust'}</span>
      ${estLabel?`<span class="${estCls}">${estLabel}</span>`:''}
    </div>
  </div>
</a>`;
}

/* ---------- portada ---------- */
// La bici «de muestra» para los números del sello (puntaje + diagnóstico completos).
function bikeMuestra(bikes){
  const cand = bikes.filter(b=>!esVendida(b));
  return cand.find(b=>fmtPuntaje(b.puntaje) && b.diagKm!=null && b.diagBat!=null && b.diagCic!=null)
      || cand.find(b=>fmtPuntaje(b.puntaje)) || cand[0] || null;
}

function heroLayerHTML(b, i){
  const foto = b.fotos && b.fotos[0];
  const inner = foto
    ? `<div class="img" role="img" aria-label="${escA('Specialized '+b.modelo+' — ver ficha certificada')}" style="background-image:url('${esc(foto)}')"></div>`
    : `<div class="noimg"><span class="m">${esc(b.modelo)}</span><span class="t">foto real pendiente · unidad en tienda</span></div>`;
  return `<a class="hv-layer${i===0?' on':''}" data-i="${i}" href="/bici/${esc(b.slug)}" aria-label="${escA('Specialized '+b.modelo+' — ver ficha certificada')}">${inner}</a>`;
}

const HOME_JS = dest => String.raw`(function(){
  var DEST=` + JSON.stringify(dest) + String.raw`;
  var reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* hero rotatorio */
  var vis=document.getElementById('bt-hero-visual');
  if(vis&&DEST.length){
    var layers=vis.querySelectorAll('.hv-layer'), dots=vis.querySelectorAll('.hero-dots button');
    var chip=vis.querySelector('.hero-chip'), idx=0, paused=false, iv=null, raf=null, safety=null;
    function bars(b){
      var el=chip.querySelector('.bars'); if(!el) return;
      var h='';
      for(var i=0;i<b.bars.length;i++){
        var r=b.bars[i];
        h+='<div class="bar"><div class="t"><span class="lb">'+r[0]+'</span><span class="vl">'+r[1]+'</span></div>'+
           '<span class="tr"><span class="fl" style="transition-delay:'+(0.12+i*0.13).toFixed(2)+'s"></span></span></div>';
      }
      h+='<a class="vf" href="'+b.href+'">Ver ficha certificada →</a>';
      el.innerHTML=h;
      var fls=el.querySelectorAll('.fl');
      function paint(){ for(var i=0;i<fls.length;i++) fls[i].style.transform='scaleX('+(b.bars[i][2]/100)+')'; }
      requestAnimationFrame(function(){requestAnimationFrame(paint);});
      setTimeout(paint,500);   // respaldo: rAF no corre en pestañas ocultas
    }
    function set(i){
      idx=i; var b=DEST[i];
      for(var k=0;k<layers.length;k++) layers[k].classList.toggle('on', k===i);
      for(var k=0;k<dots.length;k++) dots[k].classList.toggle('on', k===i);
      chip.querySelector('.mod').textContent=b.modelo;
      chip.querySelector('.tal').textContent=b.talla?('TALLA '+b.talla):'';
      chip.querySelector('.pr').textContent=b.precio;
      var pa=chip.querySelector('.pa'); if(pa){ pa.textContent=b.antes||''; pa.style.display=b.antes?'':'none'; }
      chip.querySelector('.top').setAttribute('href', b.href);
      bars(b);
      var sn=chip.querySelector('.sn .v'); if(!sn) return;
      cancelAnimationFrame(raf); clearTimeout(safety);
      var target=parseFloat(b.score)||0;
      if(reduced||!target){ sn.textContent=b.score; return; }
      var t0=performance.now(), dur=950, ticked=false;
      function step(t){ ticked=true;
        var p=Math.min(1,(t-t0)/dur), e=1-Math.pow(1-p,3);
        sn.textContent=(target*e).toFixed(1);
        if(p<1) raf=requestAnimationFrame(step); else sn.textContent=b.score;
      }
      raf=requestAnimationFrame(step);
      safety=setTimeout(function(){ if(!ticked) sn.textContent=b.score; },450);
    }
    function arm(){ clearInterval(iv);
      iv=setInterval(function(){ if(!paused&&!reduced&&DEST.length>1) set((idx+1)%DEST.length); },7000); }
    for(var k=0;k<dots.length;k++)(function(i){ dots[i].addEventListener('click',function(){ set(i); arm(); }); })(k);
    vis.addEventListener('mouseenter',function(){paused=true});
    vis.addEventListener('mouseleave',function(){paused=false});
    set(0); arm();
    /* parallax suave */
    if(!reduced){ var pr=null;
      window.addEventListener('scroll',function(){
        if(pr) return;
        pr=requestAnimationFrame(function(){ pr=null;
          var y=Math.min(window.scrollY,800); vis.style.transform='translateY('+(-y*0.05).toFixed(1)+'px)';
        });
      },{passive:true});
    }
  }
  /* reveal on scroll — fail OPEN */
  if(!reduced&&'IntersectionObserver' in window){
    var els=Array.prototype.slice.call(document.querySelectorAll('[data-reveal]')), live=false;
    var io=new IntersectionObserver(function(es){
      if(!live){ live=true;
        es.forEach(function(e){
          if(!e.isIntersecting&&e.boundingClientRect.top>0){
            e.target.style.opacity='0'; e.target.style.transform='translateY(16px)';
            e.target.style.transition='opacity .3s ease, transform .3s ease';
          } else io.unobserve(e.target);
        });
        return;
      }
      es.forEach(function(e){
        if(e.isIntersecting){ e.target.style.opacity='1'; e.target.style.transform='translateY(0)'; io.unobserve(e.target); }
      });
    },{threshold:0.1});
    els.forEach(function(el){ io.observe(el); });
    setTimeout(function(){ if(!live){ io.disconnect(); els.forEach(function(el){ el.style.opacity='1'; el.style.transform='none'; }); } },1200);
  }
  /* contadores del sello */
  var strip=document.getElementById('bt-strip');
  if(strip){
    var nums=strip.querySelectorAll('[data-n]');
    function fmt(n,f){ n=Math.round(n); return f==='miles'?String(n).replace(/\B(?=(\d{3})+(?!\d))/g,'.'):String(n); }
    function final(){ nums.forEach(function(el){
      var f=el.getAttribute('data-fmt'), n=parseFloat(el.getAttribute('data-n'));
      el.textContent = f==='dec1' ? n.toFixed(1) : fmt(n,f);
    }); }
    if(reduced||!('IntersectionObserver' in window)){ final(); }
    else{
      var done=false, ioLive=false;
      var io2=new IntersectionObserver(function(es){ ioLive=true;
        es.forEach(function(e){ if(e.isIntersecting&&!done){ done=true; io2.disconnect();
          var t0=performance.now(), dur=1100, fin=false;
          function step(t){ var p=Math.min(1,(t-t0)/dur), ease=1-Math.pow(1-p,3);
            nums.forEach(function(el){
              var f=el.getAttribute('data-fmt'), n=parseFloat(el.getAttribute('data-n'));
              el.textContent = f==='dec1' ? (n*ease).toFixed(1) : fmt(n*ease,f);
            });
            if(p<1) requestAnimationFrame(step); else fin=true;
          }
          requestAnimationFrame(step);
          setTimeout(function(){ if(!fin) final(); },dur+400);
        }});
      },{threshold:0.3});
      io2.observe(strip);
      setTimeout(function(){ if(!ioLive){ io2.disconnect(); final(); } },1200);
    }
  }
})();`;

function homeHTML(bikes){
  const disponibles = bikes.filter(b=>!esVendida(b));
  let dest = disponibles.filter(b=>b.destacada);
  if(!dest.length) dest = disponibles.filter(b=>b.fotos.length && fmtPuntaje(b.puntaje));
  dest = dest.slice(0,4);
  const m = bikeMuestra(bikes);
  const mPj = m ? fmtPuntaje(m.puntaje) : '';
  const heroData = dest.map(b=>({
    href:'/bici/'+b.slug, modelo:b.modelo, talla:b.talla,
    precio:b.precio!=null?clp(b.precio):'', antes:b.precioNuevo?clp(b.precioNuevo):null,
    score: fmtPuntaje(b.puntaje) || '',
    bars: b.desglose.slice(0,4).map(r=>{ const d=desgloseRow(r); return [d.label,d.val,d.pct]; })
  }));
  const b0 = heroData[0];
  const testimonios = !TESTIMONIOS_ON ? '' : `
<section data-reveal="1" class="wrap" style="margin-top:72px">
  <p class="kicker">Compraron certificado</p>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;margin-top:24px">
    <blockquote style="margin:0;background:var(--crema);border:1px solid var(--linea3);padding:30px 30px 26px">
      <p style="margin:0;font-family:var(--serif);font-style:italic;font-size:20px;line-height:1.5;color:var(--ink)">«El estado honesto era tan detallado que encontré menos rayones de los que declaraba la ficha. Nunca había comprado usado tan tranquila.»</p>
      <footer style="margin-top:18px;border-top:1px solid var(--linea);padding-top:14px;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px">
        <img src="/assets/brand/shield.png" alt="" style="height:16px;width:auto">
        <span style="font-size:12.5px;font-weight:600;white-space:nowrap">María José P.</span>
        <span class="mono" style="font-size:10px;letter-spacing:.12em;color:var(--meta)">LEVO SL S-WORKS · TALLA M</span>
      </footer>
    </blockquote>
    <blockquote style="margin:0;background:var(--crema);border:1px solid var(--linea3);padding:30px 30px 26px">
      <p style="margin:0;font-family:var(--serif);font-style:italic;font-size:20px;line-height:1.5;color:var(--ink)">«Me mostraron los kilómetros del motor en la pantalla del escáner antes de hablar de precio. Así da gusto comprar usado.»</p>
      <footer style="margin-top:18px;border-top:1px solid var(--linea);padding-top:14px;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px">
        <img src="/assets/brand/shield.png" alt="" style="height:16px;width:auto">
        <span style="font-size:12.5px;font-weight:600;white-space:nowrap">Cristóbal A.</span>
        <span class="mono" style="font-size:10px;letter-spacing:.12em;color:var(--meta)">KENEVO COMP · TALLA S3</span>
      </footer>
    </blockquote>
  </div>
</section>`;

  return HEAD('Bike Trust · Specialized usadas certificadas · Santiago', {path:'/', image: dest[0]&&dest[0].fotos[0] ? dest[0].fotos[0] : undefined}) + TOPBAR('') + `
<div style="min-height:100vh;display:flex;flex-direction:column;overflow-x:hidden">

<section class="hero">
  <img class="shadowlogo" src="/assets/brand/shield.png" alt="">
  <div class="hero-in">
    <div class="hero-txt">
      <p class="kicker k">Specialized usadas · Certificadas en Santiago</p>
      <h1><span>La Specialized que</span> <span class="l2">siempre quisiste.</span> <em>Certificada, y a la mitad.</em></h1>
      <span class="rule"></span>
      <p class="sub">La Kenevo, la Levo, la Epic que mirabas de lejos — a una fracción de su precio de vitrina, lista para tu primera salida desde el día uno.</p>
      <div class="ctas">
        <a class="btn-dark" href="${WA_GENERAL}" target="_blank" rel="noopener" style="padding:17px 28px;font-size:12px">Escríbenos por WhatsApp <span style="font-size:14px">↗</span></a>
        <a class="lnk" href="/catalogo" style="border-bottom-width:1px;padding-bottom:5px;font-size:12px">Ver catálogo</a>
      </div>
      <p class="dir">AV. LAS CONDES 12461 · SANTIAGO · +56 9 8523 2895</p>
    </div>
    <div class="hero-visual" id="bt-hero-visual">
      <div class="hv-float">${dest.map(heroLayerHTML).join('')}</div>
      ${b0 ? `<div class="hero-chip">
        <a class="top" href="${b0.href}">
          <div class="r1"><span class="mod">${esc(b0.modelo)}</span><span class="tal">${b0.talla?'TALLA '+esc(b0.talla):''}</span></div>
          <div class="r2"><span class="pr">${esc(b0.precio)}</span><span class="pa"${b0.antes?'':' style="display:none"'}>${esc(b0.antes||'')}</span></div>
        </a>
        <div class="score"><img src="/assets/brand/shield.png" alt="">
          <span class="sn"><span class="v">${esc(b0.score||'—')}</span><small> /7</small></span>
          <span class="sl">Puntaje de<br>certificación</span></div>
        <div class="bars"></div>
      </div>
      <div class="hero-dots">${dest.map((b,i)=>`<button type="button" class="${i===0?'on':''}" aria-label="${escA('Mostrar '+b.modelo)}"><span></span></button>`).join('')}</div>`:''}
    </div>
  </div>
</section>

<section data-reveal="1" style="background:var(--crema);border-top:1px solid var(--linea);border-bottom:1px solid var(--linea)">
  <div class="wrap" style="padding-top:64px;padding-bottom:64px">
    <p class="kicker">Delega lo que quieras</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;margin-top:26px">
      <a href="/catalogo" style="text-decoration:none;color:#F5EFE3;background:var(--ink);padding:30px 28px 26px;display:flex;flex-direction:column;min-height:190px;transition:transform .2s ease, box-shadow .2s ease" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform=''">
        <span class="mono" style="font-size:11px;letter-spacing:.2em;color:var(--bronce2)">01</span>
        <span style="font-family:var(--serif);font-weight:600;font-size:29px;margin-top:14px">Búscala tú</span>
        <span style="font-size:13.5px;line-height:1.6;color:#A99C86;margin-top:8px">Revisa las certificadas en vitrina, con puntaje y precio a la vista.</span>
        <span style="margin-top:auto;padding-top:18px;font-size:11px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--bronce3)">Ir al catálogo →</span>
      </a>
      <a href="${WA_ASESORIA}" target="_blank" rel="noopener" style="text-decoration:none;color:#F5EFE3;background:var(--ink);padding:30px 28px 26px;display:flex;flex-direction:column;min-height:190px;transition:transform .2s ease, box-shadow .2s ease" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform=''">
        <span class="mono" style="font-size:11px;letter-spacing:.2em;color:var(--bronce2)">02</span>
        <span style="font-family:var(--serif);font-weight:600;font-size:29px;margin-top:14px">Te asesoramos</span>
        <span style="font-size:13.5px;line-height:1.6;color:#A99C86;margin-top:8px">Cuéntanos cómo pedaleas y elegimos contigo, sin compromiso.</span>
        <span style="margin-top:auto;padding-top:18px;font-size:11px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--bronce3)">Asesoría por WhatsApp ↗</span>
      </a>
      <a href="/encargo" style="text-decoration:none;color:#F5EFE3;background:var(--ink);padding:30px 28px 26px;display:flex;flex-direction:column;min-height:190px;transition:transform .2s ease, box-shadow .2s ease" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform=''">
        <span class="mono" style="font-size:11px;letter-spacing:.2em;color:var(--bronce2)">03</span>
        <span style="font-family:var(--serif);font-weight:600;font-size:29px;margin-top:14px">La cazamos por ti</span>
        <span style="font-size:13.5px;line-height:1.6;color:#A99C86;margin-top:8px">Nos dices modelo y talla. La encontramos, la certificamos y te avisamos primero.</span>
        <span style="margin-top:auto;padding-top:18px;font-size:11px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--bronce3)">Dejar un encargo →</span>
      </a>
    </div>
  </div>
</section>

<section data-reveal="1" class="wrap" style="margin-top:64px">
  <div class="sec-head">
    <div><p class="kicker">Qué respalda el sello</p><h2>El sello lo firman personas.</h2></div>
    <a class="lnk" href="/como-certificamos">Cómo certificamos →</a>
  </div>
  <div style="border:1px solid var(--bronce3);background:var(--panel);margin-top:26px;padding:clamp(22px,3.4vw,36px)">
    <div id="bt-strip" class="strip3">
      <div class="card">
        <span class="n">01</span>
        <p class="t">Puntaje <small>/7</small></p>
        <p class="d">Cada bici se califica área por área con una nota pública.</p>
        <p class="f">${m&&mPj?`EJEMPLO REAL · <span class="gold"><span data-n="${mPj}" data-fmt="dec1">${mPj}</span>/7</span>`:'EN CADA FICHA'}</p>
      </div>
      <div class="card">
        <span class="n">02</span>
        <p class="t">Diagnóstico real</p>
        <p class="d">Km de motor, salud de batería y ciclos, medidos. Nada estimado.</p>
        <p class="f">${m&&m.diagKm!=null?`<span data-n="${Math.round(m.diagKm)}" data-fmt="miles">${Math.round(m.diagKm).toLocaleString('es-CL')}</span> KM · <span data-n="${m.diagBat}" data-fmt="int">${m.diagBat}</span>% BAT · <span data-n="${m.diagCic}" data-fmt="int">${m.diagCic}</span> CICLOS`:'MEDIDO EN CADA E-BIKE'}</p>
      </div>
      <div class="card">
        <span class="n">03</span>
        <p class="t">Estado honesto</p>
        <p class="d">Cada rayón y detalle, declarado antes de que preguntes.</p>
        <p class="f script">Revisada por Luis Sulbarán · Taller Bike Trust</p>
      </div>
    </div>
    <div class="figure3">
      <figure><div class="ph"><span>foto real pendiente · retrato del mecánico</span></div>
        <figcaption><span class="t1">Luis Sulbarán</span><span class="t2">MECÁNICO CERTIFICADOR</span></figcaption></figure>
      <figure><div class="ph"><span>foto real pendiente · manos y herramienta sobre un cuadro</span></div>
        <figcaption><span class="t1">Torque y ajuste, pieza por pieza</span><span class="t2">INSPECCIÓN MULTIPUNTO</span></figcaption></figure>
      <figure><div class="ph"><span>foto real pendiente · escáner de diagnóstico en pantalla</span></div>
        <figcaption><span class="t1">La lectura que va en tu ficha</span><span class="t2">DIAGNÓSTICO DIGITAL</span></figcaption></figure>
    </div>
    <div class="band-dark" style="margin-top:22px">
      <svg width="30" height="38" viewBox="0 0 24 30" fill="none" aria-hidden="true"><path d="M2 1h13l7 7v21H2z" stroke="#AF8958" stroke-width="1.4"></path><path d="M15 1v7h7" stroke="#AF8958" stroke-width="1.4"></path><path d="M7 14h10M7 19h10M7 24h6" stroke="#AF8958" stroke-width="1.4"></path></svg>
      <div style="flex:1;min-width:240px">
        <p class="bd-k">RESPALDO CON NOMBRE PROPIO</p>
        <p class="bd-t">Garantía Bike Trust</p>
        <p class="bd-s">Por escrito, firmada junto al certificado.</p>
      </div>
      <span class="bd-r">SE ENTREGA CON CADA BICI</span>
    </div>
    <p style="margin:20px 0 0;border-top:1px solid var(--linea2);padding-top:14px" class="mono"><span style="font-size:10px;letter-spacing:.18em;color:var(--meta)">CADA IMAGEN DE ESTE SITIO ES EVIDENCIA · BICIS REALES, TALLER REAL, PERSONAS REALES</span></p>
  </div>
</section>

<section data-reveal="1" class="wrap" style="margin-top:64px">
  <p class="kicker">Del mensaje al primer pedaleo</p>
  <h2 class="h-serif" style="margin:12px 0 0;font-size:clamp(34px,4.2vw,52px)">48 horas.</h2>
  <div class="steps3">
    <div class="st"><i></i><p class="k">PASO 01</p><p class="big">Hoy</p><p class="d">Te respondemos y coordinamos tu visita.</p></div>
    <div class="st"><i></i><p class="k">PASO 02</p><p class="big">24 h</p><p class="d">La pruebas mañana, preparada para ti.</p></div>
    <div class="st"><i></i><p class="k">PASO 03</p><p class="big">48 h</p><p class="d">Te la llevas lista para rodar.</p></div>
  </div>
  <p class="mono" style="margin:22px 0 0;font-size:10px;letter-spacing:.18em;color:var(--meta)">TIEMPOS REFERENCIALES</p>
</section>

<section data-reveal="1" class="wrap" style="margin-top:64px">
  <p class="kicker" style="display:block;margin-bottom:24px">La diferencia</p>
  <div class="vs">
    <div class="colA">
      <p class="k">POR TU CUENTA</p>
      <h3>Comprar usado por tu cuenta</h3>
      <p class="it"><i>—</i>Vendedor desconocido, sin taller detrás.</p>
      <p class="it"><i>—</i>Batería y motor sin verificar.</p>
      <p class="it"><i>—</i>Regateo a ciegas, sin referencia de estado.</p>
      <p class="it"><i>—</i>Las sorpresas aparecen después, en el taller.</p>
    </div>
    <div class="colB">
      <div class="hdr"><p class="k">CON BIKE TRUST</p><img src="/assets/brand/shield.png" alt=""></div>
      <h3>Comprar certificado</h3>
      <p class="it"><i>✓</i>Taller con nombre, cara y dirección.</p>
      <p class="it"><i>✓</i>Diagnóstico digital medido, por escrito.</p>
      <p class="it"><i>✓</i>Precio anclado a un puntaje público /7.</p>
      <p class="it"><i>✓</i>Sale afinada y con Garantía Bike Trust.</p>
    </div>
  </div>
</section>

<section data-reveal="1" class="wrap" style="margin-top:72px">
  <div class="sec-head">
    <div><p class="kicker">En vitrina</p><h2>${dest.length===4?'Cuatro certificadas':'Certificadas destacadas'}</h2></div>
    <a class="lnk" href="/catalogo">Ver todo el catálogo →</a>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px;margin-top:30px">
    ${dest.map(cardHTML).join('')}
  </div>
</section>
${testimonios}
<section data-reveal="1" class="wrap" style="margin-top:72px">
  <div class="darkpanel">
    <img class="shadowlogo" src="/assets/brand/shield.png" alt="" style="right:-40px;bottom:-60px;top:auto;height:280px">
    <p class="kicker gold">Parte de pago</p>
    <h2 style="max-width:20ch">Tu bici vieja paga parte de la nueva.</h2>
    <p>La evaluamos con el mismo estándar de certificación y su valor se descuenta de la que te llevas. Un solo trámite, en el mismo taller.</p>
    <a class="btn-linegold" href="${WA_PARTEPAGO}" target="_blank" rel="noopener" style="margin-top:30px">Cotiza tu parte de pago ↗</a>
  </div>
</section>

<section data-reveal="1" class="wrap" style="margin-top:72px">
  <div style="border:1px solid var(--linea3);background:var(--crema);padding:clamp(32px,5vw,56px);display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:32px;align-items:center">
    <div>
      <p class="kicker">Consigna</p>
      <h2 class="h-serif" style="margin:14px 0 0;font-size:clamp(28px,3.4vw,40px);line-height:1.15">¿Tienes una Specialized para vender?</h2>
      <p style="margin:14px 0 0;font-size:14.5px;line-height:1.7;color:var(--text);max-width:50ch">La certificamos, la publicamos en nuestra vitrina y la vendemos por ti, ante compradores que ya confían en la marca.</p>
    </div>
    <div style="display:flex;flex-direction:column;gap:14px;justify-self:start">
      <a class="btn-dark" href="/consigna" style="font-size:11.5px;padding:15px 26px">Cómo funciona la consigna</a>
      <a href="${WA_CONSIGNA}" target="_blank" rel="noopener" style="text-decoration:none;font-size:11px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--bronce);text-align:center">Conversemos por WhatsApp ↗</a>
    </div>
  </div>
</section>

<section data-reveal="1" class="wrap" style="margin-top:80px">
  <p class="kicker">Antes de comprar</p>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:32px;margin-top:24px">
    <a href="/guias#diagnostico" style="text-decoration:none;color:var(--ink);border-top:1px solid var(--ink);padding-top:20px;display:block">
      <span class="mono" style="font-size:10.5px;letter-spacing:.2em;color:var(--meta)">GUÍA 01</span>
      <h3 style="margin:12px 0 0;font-family:var(--serif);font-weight:600;font-size:25px;line-height:1.18">Cómo leer el diagnóstico de una e-bike usada</h3>
      <p style="margin:10px 0 0;font-size:13px;line-height:1.65;color:var(--text)">Qué significan los km del motor, la salud de la batería y los ciclos de carga.</p>
      <span style="display:inline-block;margin-top:14px;font-size:10.5px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--bronce)">Leer guía →</span>
    </a>
    <a href="/guias#electrica" style="text-decoration:none;color:var(--ink);border-top:1px solid var(--ink);padding-top:20px;display:block">
      <span class="mono" style="font-size:10.5px;letter-spacing:.2em;color:var(--meta)">GUÍA 02</span>
      <h3 style="margin:12px 0 0;font-family:var(--serif);font-weight:600;font-size:25px;line-height:1.18">Eléctrica o muscular: cómo elegir</h3>
      <p style="margin:10px 0 0;font-size:13px;line-height:1.65;color:var(--text)">Según tu uso, tus rutas y tu presupuesto, sin dogmas.</p>
      <span style="display:inline-block;margin-top:14px;font-size:10.5px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--bronce)">Leer guía →</span>
    </a>
    <a href="/guias#honesto" style="text-decoration:none;color:var(--ink);border-top:1px solid var(--ink);padding-top:20px;display:block">
      <span class="mono" style="font-size:10.5px;letter-spacing:.2em;color:var(--meta)">GUÍA 03</span>
      <h3 style="margin:12px 0 0;font-family:var(--serif);font-weight:600;font-size:25px;line-height:1.18">Qué es el «estado honesto»</h3>
      <p style="margin:10px 0 0;font-size:13px;line-height:1.65;color:var(--text)">Por qué declaramos cada rayón antes de que compres.</p>
      <span style="display:inline-block;margin-top:14px;font-size:10.5px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--bronce)">Leer guía →</span>
    </a>
  </div>
</section>

${MSTICKY}
</div>
<script>${HOME_JS(heroData)}</script>
` + FOOT;
}

/* ---------- catálogo ---------- */
const CATALOG_JS = String.raw`(function(){
  var cards=[].slice.call(document.querySelectorAll('.cat-grid .bc'));
  var chips=[].slice.call(document.querySelectorAll('.fchip'));
  var selT=document.getElementById('f-talla'), selP=document.getElementById('f-precio');
  var res=document.querySelector('.fbar .res'), clear=document.querySelector('.fclear'), empty=document.querySelector('.cat-empty');
  var BUCKETS={b1:[0,3000000],b2:[3000000,6000000],b3:[6000000,10000000],b4:[10000000,Infinity]};
  var disc='Todas';
  function apply(){
    var t=selT.value, p=selP.value, n=0;
    cards.forEach(function(c){
      var ok=(disc==='Todas'||c.getAttribute('data-disc')===disc)
        && (t==='todas'||c.getAttribute('data-talla')===t);
      if(ok&&p!=='todos'){ var pr=parseInt(c.getAttribute('data-precio')||'0',10), b=BUCKETS[p];
        ok = pr>=b[0]&&pr<=b[1]; }
      c.style.display=ok?'':'none'; if(ok) n++;
    });
    chips.forEach(function(ch){ ch.classList.toggle('on', ch.getAttribute('data-d')===disc); });
    if(res) res.textContent=n+(n===1?' RESULTADO':' RESULTADOS');
    var filtered=(disc!=='Todas'||t!=='todas'||p!=='todos');
    if(clear) clear.classList.toggle('hidden', !filtered);
    if(empty) empty.classList.toggle('hidden', !(cards.length>0&&n===0));
  }
  chips.forEach(function(ch){ ch.addEventListener('click',function(){ disc=ch.getAttribute('data-d'); apply(); }); });
  if(selT) selT.addEventListener('change',apply);
  if(selP) selP.addEventListener('change',apply);
  if(clear) clear.addEventListener('click',function(){ disc='Todas'; selT.value='todas'; selP.value='todos'; apply(); });
  try{ var d=new URLSearchParams(location.search).get('d'); if(d){ var m={'MTB':'MTB','Ruta':'Ruta','Urbana':'Urbana'}[d]; if(m) disc=m; } }catch(e){}
  apply();
})();`;

// Orden natural de tallas: S1..S6, luego XS/S/M/L/XL, luego numéricas (ruta).
function ordenTallas(tallas){
  const rank = t => {
    const m=String(t).match(/^S(\d)$/i); if(m) return 100+Number(m[1]);
    const letras={XS:201,S:202,M:203,L:204,XL:205}; if(letras[String(t).toUpperCase()]!=null) return letras[String(t).toUpperCase()];
    const n=Number(t); if(isFinite(n)) return 300+n;
    return 400;
  };
  return [...tallas].sort((a,b)=>rank(a)-rank(b));
}

function catalogoHTML(bikes){
  const nDisp = bikes.filter(b=>!esVendida(b)).length;
  const nVend = bikes.length - nDisp;
  const discos = ['Todas', ...new Set(bikes.map(b=>b.disciplina).filter(Boolean))];
  const tallas = ordenTallas(new Set(bikes.map(b=>b.talla).filter(Boolean)));
  const contador = nVend
    ? `${nDisp} EN VITRINA · ${nVend} YA VENDIDA${nVend===1?'':'S'}`
    : `${nDisp} BICIS · PUNTAJE Y PRECIO A LA VISTA`;
  return HEAD('Catálogo · Specialized usadas certificadas · Bike Trust', {path:'/catalogo'}) + TOPBAR('catalogo') + `
<div style="min-height:100vh;display:flex;flex-direction:column">
<section class="wrap" style="margin-top:56px">
  <div class="cat-head">
    <div>
      <p class="kicker">El catálogo</p>
      <h1>Cada una, certificada.</h1>
    </div>
    <p class="n">${contador}</p>
  </div>
</section>

<section class="wrap" style="margin-top:24px">
  <div class="filters">
    <div class="fchips">
      ${discos.map((d,i)=>`<button type="button" class="fchip${i===0?' on':''}" data-d="${escA(d)}">${esc(d)}</button>`).join('')}
    </div>
    <div class="fsels">
      <select id="f-talla" class="fsel">
        <option value="todas">Talla · Todas</option>
        ${tallas.map(t=>`<option value="${escA(t)}">${esc(t)}</option>`).join('')}
      </select>
      <select id="f-precio" class="fsel">
        <option value="todos">Precio · Todos</option>
        <option value="b1">Hasta $3.000.000</option>
        <option value="b2">$3M a $6M</option>
        <option value="b3">$6M a $10M</option>
        <option value="b4">Sobre $10M</option>
      </select>
    </div>
  </div>
  <div class="fbar">
    <span class="res">${bikes.length} RESULTADOS</span>
    <button type="button" class="fclear hidden">Limpiar filtros</button>
  </div>
</section>

<section class="wrap" style="margin-top:26px">
  <div class="cat-grid">
    ${bikes.map(cardHTML).join('')}
  </div>
  <div class="cat-empty hidden" style="margin-top:20px">
    <p class="m">0 RESULTADOS CON ESOS FILTROS</p>
    <h3>¿No está la que buscas? La conseguimos.</h3>
    <p>Déjanos el encargo: modelo, talla y presupuesto. La buscamos, la certificamos y te avisamos primero.</p>
    <a class="btn-dark" href="/encargo" style="margin-top:24px;padding:15px 28px">Encargar mi bici →</a>
  </div>
</section>

<section class="wrap" style="margin-top:64px">
  <div class="enc-band">
    <div>
      <p class="kicker">Encargo</p>
      <h2>¿No está la que buscas? La conseguimos.</h2>
      <p>Modelo, talla y presupuesto. La encontramos en nuestra red, la certificamos y te avisamos primero.</p>
    </div>
    <a class="btn-dark" href="/encargo" style="white-space:nowrap">Dejar un encargo →</a>
  </div>
</section>
${MSTICKY}
</div>
<script>${CATALOG_JS}</script>
` + FOOT;
}

/* ---------- reserva (modal de agendamiento) ---------- */
// Horarios de visita ofrecidos (10:00–18:30 cada 30 min). Ajustable.
function timeSlots(){
  const out=[];
  for(let h=10;h<=18;h++) for(const m of ['00','30']) out.push(h+':'+m);
  return out;
}
// JS del modal. String.raw evita que build.mjs "coma" los backslashes de los regex.
// Mismo contrato que siempre: POST /api/reservar {fecha,hora,modelos,modelosSlug,modelosId,nombre,email,telefono}.
const RESERVA_JS = String.raw`(function(){
  var WA_NUM='` + WA_NUM + String.raw`';
  var ov=document.getElementById('rsv'); if(!ov) return;
  var dlg=ov.querySelector('.rsv'), form=ov.querySelector('.rsv-form');
  var stepn=ov.querySelector('.rsv-stepn'), cbs=ov.querySelectorAll('.rsv-cb'), count=ov.querySelector('.rsv-count');
  var bBack=ov.querySelector('.rsv-back'), bNext=ov.querySelector('.rsv-next'), bSubmit=ov.querySelector('.rsv-submit'), bDone=ov.querySelector('.rsv-done');
  var MAX=3, busy=false;
  function q(s){ return ov.querySelector(s); }
  function show(el,on){ el.classList[on?'remove':'add']('hidden'); }
  function ymd(d){ var m=d.getMonth()+1, day=d.getDate(); return d.getFullYear()+'-'+(m<10?'0':'')+m+'-'+(day<10?'0':'')+day; }
  function maxBizDate(){ var d=new Date(), n=0; while(n<5){ d.setDate(d.getDate()+1); var wd=d.getDay(); if(wd!==0&&wd!==6) n++; } return d; } // 5 días hábiles desde hoy
  function minDate(){ var d=new Date(), wd; do { d.setDate(d.getDate()+1); wd=d.getDay(); } while(wd===0||wd===6); return d; } // primer día hábil DESPUÉS de hoy (no mismo día)
  function setStep(n){
    [].forEach.call(ov.querySelectorAll('.rsv-step'),function(s){ s.classList.toggle('on', s.getAttribute('data-step')===String(n)); });
    var num = (n===1||n===2);
    if(num) stepn.textContent='Paso '+n+' de 2';
    if(n==='ok') stepn.textContent='Listo';
    show(bBack,n===2); show(bNext,n===1); show(bSubmit,n===2); show(bDone,n==='ok');
    dlg.scrollTop=0;
  }
  function syncModels(){
    var sel=[].filter.call(cbs,function(c){return c.checked;});
    count.textContent=sel.length+'/'+MAX;
    [].forEach.call(cbs,function(c){
      c.disabled = !c.checked && sel.length>=MAX;
      var row=c.closest('.rsv-model');
      row.classList.toggle('sel',c.checked); row.classList.toggle('dis',c.disabled);
    });
  }
  [].forEach.call(cbs,function(c){ c.addEventListener('change',syncModels); });
  function err(sel,msg){ var e=q(sel); e.textContent=msg; e.classList.remove('hidden'); }
  function openModal(slug){
    form.reset();
    [].forEach.call(cbs,function(c){ c.checked=false; });
    if(slug){ var cb=ov.querySelector('.rsv-cb[value="'+slug+'"]'); if(cb) cb.checked=true; }
    syncModels();
    q('.rsv-err1').classList.add('hidden'); q('.rsv-err2').classList.add('hidden');
    var dt=q('.rsv-date'); dt.min=ymd(minDate()); dt.max=ymd(maxBizDate());
    ov.classList.add('open'); document.body.style.overflow='hidden';
    setStep(1);
  }
  function closeModal(){ ov.classList.remove('open'); document.body.style.overflow=''; }
  bNext.addEventListener('click',function(){
    var v=q('.rsv-date').value;
    if(!v) return err('.rsv-err1','Elige una fecha.');
    if(v<ymd(minDate())) return err('.rsv-err1','No agendamos para el mismo día; elige desde el día siguiente.');
    if(v>ymd(maxBizDate())) return err('.rsv-err1','El plazo máximo para agendar es de 5 días hábiles.');
    var wd=new Date(v+'T00:00').getDay();
    if(wd===0||wd===6) return err('.rsv-err1','Atendemos en días hábiles (lunes a viernes).');
    if(!q('.rsv-time').value) return err('.rsv-err1','Elige una hora.');
    q('.rsv-err1').classList.add('hidden'); setStep(2);
  });
  bBack.addEventListener('click',function(){ setStep(1); });
  bDone.addEventListener('click',closeModal);
  form.addEventListener('submit',function(e){
    e.preventDefault(); if(busy) return;
    var sel=[].filter.call(cbs,function(c){return c.checked;});
    if(!sel.length) return err('.rsv-err2','Elige al menos un modelo.');
    var nombre=q('.rsv-name').value.trim(), email=q('.rsv-email').value.trim(), tel=q('.rsv-phone').value.trim();
    if(!nombre) return err('.rsv-err2','Escribe tu nombre.');
    if(tel.replace(/\D/g,'').length<8) return err('.rsv-err2','Escribe un teléfono válido.');
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err('.rsv-err2','Escribe un correo válido.');
    q('.rsv-err2').classList.add('hidden');
    var modelos=sel.map(function(c){return c.getAttribute('data-label');});
    var payload={ fecha:q('.rsv-date').value, hora:q('.rsv-time').value, modelos:modelos,
      modelosSlug:sel.map(function(c){return c.value;}),
      modelosId:sel.map(function(c){return c.getAttribute('data-recid');}),
      nombre:nombre, email:email, telefono:tel };
    busy=true; bSubmit.textContent='Enviando…'; bSubmit.disabled=true;
    fetch('/api/reservar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(function(r){ if(!r.ok) throw 0; return r.json(); })
      .then(function(){ done(payload,false); })
      .catch(function(){ done(payload,true); })
      .then(function(){ busy=false; bSubmit.textContent='Confirmar reserva'; bSubmit.disabled=false; });
  });
  function done(p,fb){
    if(fb){
      var t='Hola! Quiero agendar una visita.%0aModelos: '+encodeURIComponent(p.modelos.join(', '))+'%0aDia: '+p.fecha+' '+p.hora+'%0aNombre: '+encodeURIComponent(p.nombre);
      q('.rsv-ok h3').textContent='Último paso';
      q('.rsv-okmsg').innerHTML='Confirma tu visita por WhatsApp y te dejamos los modelos preparados.<br><a class="rsv-wa" href="https://wa.me/'+WA_NUM+'?text='+t+'" target="_blank" rel="noopener">Confirmar por WhatsApp</a>';
    } else {
      q('.rsv-ok h3').textContent='Reserva enviada';
      q('.rsv-okmsg').textContent='Te contactaremos para confirmar tu visita el '+p.fecha+' a las '+p.hora+'. ¡Te esperamos en Av. Las Condes 12461!';
    }
    setStep('ok');
  }
  [].forEach.call(document.querySelectorAll('.js-agendar'),function(b){
    b.addEventListener('click',function(e){ e.preventDefault(); openModal(b.getAttribute('data-slug')); });
  });
  ov.querySelector('.rsv-x').addEventListener('click',closeModal);
  ov.querySelector('.rsv-ov-bg').addEventListener('click',closeModal);
  document.addEventListener('keydown',function(e){ if(e.key==='Escape' && ov.classList.contains('open')) closeModal(); });
})();`;

function reservaModal(bikes){
  const slots = timeSlots().map(t=>`<option value="${t}">${t}</option>`).join('');
  const models = bikes.filter(b=>!esVendida(b)).map(b=>{
    const label=escA(b.modelo + (b.talla?' · Talla '+b.talla:''));
    return `<label class="rsv-model"><input type="checkbox" class="rsv-cb" value="${escA(b.slug)}" data-label="${label}" data-recid="${escA(b.recId)}">${esc(b.modelo)}${b.talla?' · '+esc(b.talla):''}</label>`;
  }).join('');
  return `<div class="rsv-ov" id="rsv" aria-hidden="true"><div class="rsv-ov-bg"></div>
  <div class="rsv" role="dialog" aria-modal="true" aria-label="Agenda tu visita">
    <div class="rsv-hd">
      <div><p class="rsv-stepn">Paso 1 de 2</p><p class="rsv-ttl">Agenda tu visita</p></div>
      <button type="button" class="rsv-x" aria-label="Cerrar">×</button>
    </div>
    <form class="rsv-form" novalidate>
      <div class="rsv-bd">
        <div class="rsv-step on" data-step="1">
          <p class="rsv-intro">Elige día y hora para visitarnos en Av. Las Condes 12461. Te contactamos para confirmar.</p>
          <div class="rsv-grid">
            <label class="rsv-lbl">Fecha<input type="date" class="rsv-date" required></label>
            <label class="rsv-lbl">Hora<select class="rsv-time" required><option value="">Elige una hora</option>${slots}</select></label>
          </div>
          <div class="rsv-err rsv-err1 hidden"></div>
        </div>
        <div class="rsv-step" data-step="2">
          <p class="rsv-sub">¿Qué modelos quieres ver? · <span class="rsv-count">0/3</span></p>
          <p class="rsv-note">Si te interesa ver más modelos, avísanos para tenértelos preparados.</p>
          <div class="rsv-models">${models}</div>
          <div class="rsv-grid2">
            <label class="rsv-lbl">Nombre<input type="text" class="rsv-name" placeholder="Tu nombre" autocomplete="name" required></label>
            <label class="rsv-lbl">Teléfono<input type="tel" class="rsv-phone" placeholder="+56 9 …" autocomplete="tel" required></label>
          </div>
          <div class="rsv-field"><label class="rsv-lbl">Correo<input type="email" class="rsv-email" placeholder="tu@correo.cl" autocomplete="email" required></label></div>
          <div class="rsv-err rsv-err2 hidden"></div>
        </div>
        <div class="rsv-step rsv-ok" data-step="ok">
          <img src="/assets/brand/shield.png" alt="">
          <h3>Reserva enviada</h3><p class="rsv-okmsg"></p>
        </div>
      </div>
      <div class="rsv-ft">
        <button type="button" class="rsv-btn ghost rsv-back hidden">← Atrás</button>
        <button type="button" class="rsv-btn rsv-next">Continuar →</button>
        <button type="submit" class="rsv-btn rsv-submit hidden">Confirmar reserva</button>
        <button type="button" class="rsv-btn rsv-done hidden">Listo</button>
      </div>
    </form>
  </div></div>
<script>${RESERVA_JS}</script>`;
}

/* ---------- ficha e-commerce ---------- */
const FICHA_JS = String.raw`(function(){
  var main=document.querySelector('.pgal .main img'), cap=document.querySelector('.pgal .cap .alt');
  [].forEach.call(document.querySelectorAll('.pgal .th'),function(t){
    t.addEventListener('click',function(){
      if(!main) return;
      main.src=t.getAttribute('data-src'); main.alt=t.getAttribute('data-alt')||'';
      if(cap) cap.textContent=(t.getAttribute('data-alt')||'').toUpperCase();
      [].forEach.call(document.querySelectorAll('.pgal .th'),function(x){ x.classList.remove('on'); });
      t.classList.add('on');
    });
  });
  [].forEach.call(document.querySelectorAll('.specs .tabbtn'),function(b){
    b.addEventListener('click',function(){
      [].forEach.call(document.querySelectorAll('.specs .tabbtn'),function(x){ x.classList.remove('on'); });
      [].forEach.call(document.querySelectorAll('.specs .panel'),function(p){ p.classList.remove('on'); });
      b.classList.add('on');
      var p=document.getElementById(b.getAttribute('data-tab')); if(p) p.classList.add('on');
    });
  });
})();`;

function fichaHTML(b, bikes){
  const vend = esVendida(b), res = esReservada(b);
  const pj = fmtPuntaje(b.puntaje);
  const fotos = b.fotos || [];
  const fitline = [
    b.talla ? 'TALLA '+esc(b.talla) : null,
    b.rangoAltura ? 'CALZA '+esc(b.rangoAltura.toUpperCase()) : null,
    b.referencia ? 'REF '+esc(b.referencia) : null
  ].filter(Boolean).join(' · ');
  const waF = waFicha(b);
  const encHref = encargoHref(b);
  const emitida = new Date().toLocaleDateString('es-CL',{month:'short',year:'numeric'}).replace('.','').toUpperCase();

  const galeria = fotos.length ? `
    <div class="pgal${vend?' is-vendida':''}">
      <div class="frame"><div class="main"><img src="${esc(fotos[0])}" alt="${escA('Specialized '+b.modelo+' — foto 1')}"></div></div>
      ${fotos.length>1?`<div class="thumbs">${fotos.slice(0,8).map((f,i)=>`<button type="button" class="th${i===0?' on':''}" data-src="${escA(f)}" data-alt="${escA('Foto '+(i+1))}"><span><img src="${esc(f)}" alt="${escA('Miniatura '+(i+1))}" loading="lazy"></span></button>`).join('')}</div>`:''}
      <p class="cap">FOTOS REALES DE ESTA UNIDAD${b.fotoReferencial?' · FOTO REFERENCIAL DEL MODELO':''} · <span class="alt">FOTO 1</span></p>
    </div>`
  : `<div class="pgal-ph"><span>${vend?'unidad vendida':'fotos en preparación · pídelas por whatsapp'}</span></div>`;

  const certSection = pj ? `
<section id="certificacion" class="wrap" style="margin-top:56px">
  <div class="certbox">
    <div class="hd2"><span class="l">Puntaje de certificación</span><span class="r">${b.referencia?`CERTIFICADO Nº ${esc(b.referencia)}`:'CERTIFICADO BIKE TRUST'}</span></div>
    <div class="bd">
      <div class="big">
        <div class="n">${pj}<small> /7</small></div>
        <div class="sello"><img src="/assets/brand/shield.png" alt=""><span>Certificada por Bike Trust · Santiago</span></div>
      </div>
      <div class="desg">
        ${b.desglose.length?`<p class="k">Desglose de la certificación</p>
        ${b.desglose.map(r=>{ const d=desgloseRow(r); return `<div class="row"><span class="lb">${esc(d.label)}</span><span class="tr"><span class="fl" style="width:${d.pct}%"></span></span><span class="vl">${esc(d.val)}</span></div>`; }).join('')}`:''}
        <div class="foot2"><a href="/como-certificamos">Cómo medimos el puntaje →</a><span class="d">EMITIDA · ${esc(emitida)}</span></div>
      </div>
    </div>
  </div>
</section>` : '';

  const hayDiag = b.electrica && (b.diagKm!=null || b.diagBat!=null || b.diagCic!=null);
  const diagSection = hayDiag ? `
<section class="wrap" style="margin-top:22px">
  <div class="diag3">
    <div><p class="l">KM DEL MOTOR</p><p class="v">${b.diagKm!=null?Math.round(b.diagKm).toLocaleString('es-CL'):'—'}<small> km</small></p></div>
    <div><p class="l">SALUD DE BATERÍA</p><p class="v">${b.diagBat!=null?b.diagBat+'%':'—'}</p></div>
    <div><p class="l">CICLOS DE CARGA</p><p class="v">${b.diagCic!=null?esc(b.diagCic):'—'}</p></div>
  </div>
  <p class="diag-note">DATOS REALES MEDIDOS SOBRE ESTA BICI. NADA ESTIMADO.</p>
</section>` : '';

  // Detalles (campos base) + Componentes (Specs clave) + Geometría — pestañas.
  const detalles = [
    ['Marca', b.marca], ['Modelo', b.modelo], ['Año', b.anio], ['Disciplina', b.disciplina],
    ['Motorización', b.electrica?'Eléctrica':'Muscular'], ['Talla', b.talla],
    ['Rango de altura', b.rangoAltura], ['Material del cuadro', b.material],
    ['Referencia', b.referencia], ['Precio Bike Trust', b.precio!=null?clp(b.precio):null],
    ['Valor de nueva', b.precioNuevo?clp(b.precioNuevo):null]
  ].filter(([,v])=>v!=null&&v!=='');
  const flatRows = g => g.flatMap(x=>x.filas);
  const tabs = [
    ['detalles','Detalles', detalles],
    ['componentes','Componentes', flatRows(b.specs)],
    ['geometria','Geometría', flatRows(b.geometria)]
  ].filter(([, ,rows])=>rows.length);
  const specsSection = tabs.length ? `
  <section class="wrap specs" style="margin-top:56px">
    <p class="kicker">Especificaciones</p>
    <div class="tabs">${tabs.map(([id,l],i)=>`<button type="button" class="tabbtn${i===0?' on':''}" data-tab="tab-${id}">${l}</button>`).join('')}</div>
    ${tabs.map(([id, ,rows],i)=>`<div class="panel${i===0?' on':''}" id="tab-${id}">${rows.map(([k,v])=>`<div class="prow"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('')}</div>`).join('')}
  </section>` : '';

  const honSection = b.estado.length ? `
  <section class="wrap" style="margin-top:56px">
    <div class="hon-grid">
      <div class="hon-card">
        <p class="k">Estado honesto</p>
        <p class="q">«Lo declaramos antes de que preguntes.»</p>
        ${b.estado.map((t,i)=>`<p class="it"><span class="n">0${i+1}</span><span>${esc(t)}</span></p>`).join('')}
      </div>
    </div>
  </section>` : '';

  const full = tabs.length>1 || b.estado.length;   // con solo «Detalles» base la tratamos como compacta
  const compacta = (!full && !vend) ? `
  <section class="wrap" style="margin-top:56px">
    <div class="compacta">
      <p class="m">FICHA EN PUBLICACIÓN</p>
      <p>El detalle completo de esta unidad —notas del mecánico, estado honesto y especificaciones— se comparte por WhatsApp mientras terminamos de publicarla.</p>
    </div>
  </section>` : '';

  const dispStrip = (!vend && !res) ? `
<section class="wrap" style="margin-top:56px">
  <div class="disp-strip">
    <span class="dot"><i></i>DISPONIBLE HOY</span>
    <span class="sep">—</span><span>TE LA PREPARAMOS PARA MAÑANA</span>
    <span class="sep">—</span><span>RESPUESTA POR WHATSAPP HOY</span>
  </div>
</section>` : '';

  const notaEstado = res
    ? `<p class="f-nota">Reservada con seña. <b>Déjanos tus datos</b> por si se libera.</p>`
    : (b.reservada && !vend
      ? `<p class="f-nota"><b>Alguien agendó una visita para verla.</b> Sigue disponible — agéndala tú también.</p>` : '');

  const titulo = `Specialized ${b.modelo} · Ficha certificada · Bike Trust`;
  return HEAD(titulo, {path:'/bici/'+b.slug, image: fotos[0], type:'product',
    desc:`Specialized ${b.modelo}${b.talla?' talla '+b.talla:''} usada certificada${pj?' · Puntaje '+pj+'/7':''}${b.precio!=null?' · '+clp(b.precio):''} · Santiago.`}) + TOPBAR('catalogo') + `
<div style="min-height:100vh;display:flex;flex-direction:column">
${vend?`<div class="vend-banner">
  <span class="k">Vendida</span>
  <span class="t">¿Llegaste tarde? Te conseguimos una igual.</span>
  <a href="${encHref}">Encargar una igual →</a>
</div>`:''}
<section class="wrap crumbs" style="margin-top:26px">
  <a href="/catalogo">← Catálogo</a>
  <span class="n">FICHA TÉCNICA${b.referencia?` · CERTIFICADO Nº ${esc(b.referencia)}`:''}</span>
</section>

<section class="wrap f-grid" style="margin-top:22px">
  <div>${galeria}</div>
  <div class="f-info">
    <p class="meta">${esc(metaLine(b))}</p>
    <h1><span class="marca">SPECIALIZED</span>${esc(b.modelo)}</h1>
    ${fitline?`<p class="fitline">${fitline}</p>`:''}
    ${b.porQue?`<p class="resumen">${esc(b.porQue)}</p>`:''}
    <div class="f-price">
      <span class="p${vend?' muted':''}">${b.precio!=null?clp(b.precio):'—'}</span>
      ${b.precioNuevo?`<span class="pa">${clp(b.precioNuevo)}</span>`:''}
      ${vend?`<span class="chip vend">Vendida</span>`:(res?`<span class="chip">Reservada</span>`:'')}
    </div>
    ${notaEstado}
    <div class="buybox">
      <p class="k">${vend?'Se vendió — la cazamos por ti':'Un toque, sin formularios'}</p>
      <a class="btn-gold" href="${vend?encHref:waF}"${vend?'':' target="_blank" rel="noopener"'}>${vend?'Te conseguimos una igual →':'Recibir la ficha por WhatsApp ↗'}</a>
      ${vend?'':`<button type="button" class="agendar js-agendar" data-slug="${escA(b.slug)}">O agenda tu visita al taller</button>`}
      <p class="cap">${vend?'Dinos modelo, talla y presupuesto: la buscamos, la certificamos y te avisamos primero.':'Te llega el certificado completo con tu nombre. El documento no se descarga desde el sitio.'}</p>
    </div>
    <div class="f-cert-mini">
      <img src="/assets/brand/shield.png" alt="">
      <span class="c">${pj?`Certificada · ${pj}/7`:'Certificada Bike Trust'}</span>
      ${pj?`<a href="#certificacion">Ver desglose ↓</a>`:''}
    </div>
  </div>
</section>
${certSection}
${diagSection}
<section class="wrap" style="margin-top:22px">
  <div class="band-dark">
    <svg width="30" height="38" viewBox="0 0 24 30" fill="none" aria-hidden="true"><path d="M2 1h13l7 7v21H2z" stroke="#AF8958" stroke-width="1.4"></path><path d="M15 1v7h7" stroke="#AF8958" stroke-width="1.4"></path><path d="M7 14h10M7 19h10M7 24h6" stroke="#AF8958" stroke-width="1.4"></path></svg>
    <div style="flex:1;min-width:240px">
      <p class="bd-k">RESPALDO CON NOMBRE PROPIO</p>
      <p class="bd-t">Garantía Bike Trust</p>
      <p class="bd-s">Por escrito, firmada junto al certificado${b.referencia?' Nº '+esc(b.referencia):''}.</p>
    </div>
    <span class="bd-r">SE ENTREGA CON LA BICI</span>
  </div>
</section>
${honSection}
${specsSection}
${compacta}
${dispStrip}
${vend?'':`<section class="wrap" style="margin-top:26px">
  <div class="cta2">
    <div class="lite">
      <p class="k">Parte de pago</p>
      <h2>Tu bici vieja paga parte de esta.</h2>
      <p>La evaluamos con el mismo estándar y su valor se descuenta aquí mismo. Un solo trámite.</p>
      <a href="${WA_PARTEPAGO}" target="_blank" rel="noopener">Cotiza tu parte de pago ↗</a>
    </div>
  </div>
</section>`}

<div class="msticky-space"></div>
<div class="msticky">
  <div class="info"><span class="p">${b.precio!=null?clp(b.precio):''}</span><span class="c">${pj?`Certificada ${pj}/7`:'Certificada'}</span></div>
  <a class="cta" href="${vend?encHref:waF}"${vend?'':' target="_blank" rel="noopener"'}>${vend?'Te conseguimos una igual →':'Recibir ficha por WhatsApp ↗'}</a>
</div>
</div>
${vend?'':reservaModal(bikes)}
<script>${FICHA_JS}</script>
` + FOOT;
}

/* ---------- página: cómo certificamos ---------- */
function comoCertificamosHTML(bikes){
  const m = bikeMuestra(bikes);
  const ejemplo = (m && m.diagKm!=null && m.diagBat!=null && m.diagCic!=null) ? `
      <div style="border:1px solid var(--linea);background:var(--crema);padding:18px 20px">
        <p class="mono" style="margin:0;font-size:9.5px;letter-spacing:.2em;color:var(--meta)">EJEMPLO REAL · ${esc((m.modelo+' '+m.talla).toUpperCase())}</p>
        <div style="display:flex;gap:22px;margin-top:12px;flex-wrap:wrap">
          <span style="display:flex;flex-direction:column"><b style="font-family:var(--serif);font-weight:600;font-size:26px">${Math.round(m.diagKm).toLocaleString('es-CL')}</b><span style="font-size:9.5px;letter-spacing:.16em;color:var(--meta)">KM MOTOR</span></span>
          <span style="display:flex;flex-direction:column"><b style="font-family:var(--serif);font-weight:600;font-size:26px">${m.diagBat}%</b><span style="font-size:9.5px;letter-spacing:.16em;color:var(--meta)">BATERÍA</span></span>
          <span style="display:flex;flex-direction:column"><b style="font-family:var(--serif);font-weight:600;font-size:26px">${esc(m.diagCic)}</b><span style="font-size:9.5px;letter-spacing:.16em;color:var(--meta)">CICLOS</span></span>
        </div>
      </div>` : '';
  return HEAD('Cómo certificamos · Bike Trust', {path:'/como-certificamos'}) + TOPBAR('certificacion') + `
<div style="min-height:100vh;display:flex;flex-direction:column">
<section class="wrap pg-hero" style="margin-top:64px">
  <p class="kicker">El estándar Bike Trust</p>
  <h1>Cómo certificamos</h1>
  <p class="lead">Comprar una bici usada no debería ser una apuesta. Cada Specialized que publicamos pasa por el mismo proceso, y todo lo que medimos queda a la vista.</p>
  <p class="cite">«Inspeccionada por mecánicos expertos, medida con datos reales y entregada con su estado honesto declarado de frente.»</p>
</section>

<section class="wrap" style="margin-top:56px">
  <div class="cards3" style="grid-template-columns:repeat(auto-fit,minmax(290px,1fr))">
    <div class="icard" style="padding:32px 30px">
      <span class="n">01 · TALLER</span>
      <h3 style="font-size:28px">Inspección multipunto</h3>
      <p style="font-size:13.5px;margin-bottom:18px">Mecánicos expertos revisan la bici punto por punto. Se limpia, se afina y se reemplaza lo que haga falta antes de publicar.</p>
      <div class="checks">
        <span><i>✓</i>Integridad del cuadro verificada</span>
        <span><i>✓</i>Transmisión limpiada y afinada</span>
        <span><i>✓</i>Frenos purgados y probados</span>
        <span><i>✓</i>Suspensión revisada</span>
        <span><i>✓</i>Ruedas centradas</span>
      </div>
    </div>
    <div class="icard" style="padding:32px 30px">
      <span class="n">02 · DATOS</span>
      <h3 style="font-size:28px">Diagnóstico digital</h3>
      <p style="font-size:13.5px;margin-bottom:18px">En las e-bikes escaneamos el sistema Specialized. Lo que ves en la ficha es lo que la bici realmente tiene. Nada estimado.</p>
      ${ejemplo}
      <p style="margin-top:16px;font-size:12.5px;color:var(--muted)">En bicis musculares, esta etapa se reemplaza por la revisión de ruedas, dirección y puntos de desgaste.</p>
    </div>
    <div class="icard" style="padding:32px 30px">
      <span class="n">03 · ENTREGA</span>
      <h3 style="font-size:28px">Entrega con respaldo</h3>
      <p style="font-size:13.5px">La recibes afinada, con su certificado emitido a tu nombre y el respaldo del taller que la revisó.</p>
      <p style="font-size:13.5px">Si algo certificado falla, respondemos nosotros: la garantía cubre los puntos inspeccionados del certificado.</p>
      <p class="fine" style="border-top:1px solid var(--linea2)">TÉRMINOS COMPLETOS EN CADA CERTIFICADO</p>
    </div>
  </div>
</section>

<section class="wrap" style="margin-top:64px">
  <div class="darkpanel">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:44px;align-items:center">
      <div>
        <p class="kicker gold">El puntaje</p>
        <h2>Qué mide la nota <span style="color:var(--bronce2)">/7</span></h2>
        <p style="max-width:50ch;font-size:14px;line-height:1.75">Cada área se evalúa de 1 a 7 en el taller y la nota se publica tal cual queda en el certificado. Un 7 es estado de vitrina. Si un área no supera nuestro mínimo, la bici no se publica: se repara o se devuelve.</p>
        <p style="max-width:50ch;font-size:14px;line-height:1.75;margin-top:14px">Las áreas se adaptan al tipo de bici: en una e-bike pesa el motor y la electrónica; en una de ruta, las ruedas y la cabina.</p>
      </div>
      <div>
        <div class="arow"><span class="id">A</span><span class="nm">Cuadro y Estructura</span><span class="dt">alineación · fisuras · rodamientos</span></div>
        <div class="arow"><span class="id">B</span><span class="nm">Motor y Electrónica</span><span class="dt">escaneo · batería · conectores</span></div>
        <div class="arow"><span class="id">C</span><span class="nm">Suspensiones</span><span class="dt">retenes · presiones · recorrido</span></div>
        <div class="arow"><span class="id">D</span><span class="nm">Frenos y Transmisión</span><span class="dt">pastillas · cadena · cambios</span></div>
        <p class="mono" style="margin:16px 0 0;font-size:10px;letter-spacing:.18em;color:var(--darkdeep)">EL DESGLOSE COMPLETO VA EN CADA FICHA</p>
      </div>
    </div>
  </div>
</section>

<section class="wrap" style="margin-top:64px">
  <div class="hon-grid">
    <div class="hon-card" style="padding:32px 30px">
      <p class="k">El estado honesto</p>
      <h3 style="margin:14px 0 0;font-family:var(--serif);font-weight:600;font-size:27px;line-height:1.15">Los defectos, de frente.</h3>
      <p style="margin:12px 0 0;font-size:13.5px;line-height:1.7;color:var(--text)">Declaramos cada rayón, marca o detalle real de la unidad en su ficha, numerado. Preferimos que lo sepas antes de comprar: el riesgo del usado no es el desgaste, es la información que te ocultan.</p>
      <a href="/guias#honesto" style="display:inline-block;margin-top:16px;text-decoration:none;font-size:10.5px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--bronce)">Leer la guía →</a>
    </div>
    <div class="hon-card" style="padding:32px 30px">
      <p class="k">La garantía</p>
      <h3 style="margin:14px 0 0;font-family:var(--serif);font-weight:600;font-size:27px;line-height:1.15">Respaldo del taller que la revisó.</h3>
      <p style="margin:12px 0 0;font-size:13.5px;line-height:1.7;color:var(--text)">Toda certificada sale con garantía de taller sobre los puntos inspeccionados. Si algo del certificado falla, lo resolvemos nosotros. Los términos van por escrito con cada bici.</p>
      <p class="mono" style="margin:16px 0 0;font-size:10px;letter-spacing:.16em;color:var(--meta)">EMITIDA CON CADA CERTIFICADO · SANTIAGO</p>
    </div>
  </div>
</section>

<section class="wrap" style="margin-top:64px">
  <div style="border:1px solid var(--linea3);background:var(--panel);padding:clamp(32px,5vw,48px);display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:20px">
    <div>
      <h2 class="h-serif" style="margin:0;font-size:clamp(26px,3.2vw,36px)">¿Dudas sobre una bici en particular?</h2>
      <p style="margin:10px 0 0;font-size:13.5px;color:var(--text)">Te explicamos su certificado punto por punto, sin apuro.</p>
    </div>
    <a class="btn-dark" href="${WA_CERT}" target="_blank" rel="noopener">Pregunta por WhatsApp ↗</a>
  </div>
</section>
${MSTICKY}
</div>
` + FOOT;
}

/* ---------- página: consigna ---------- */
function consignaHTML(){
  return HEAD('Consigna tu Specialized · Bike Trust', {path:'/consigna'}) + TOPBAR('consigna') + `
<div style="min-height:100vh;display:flex;flex-direction:column">
<section class="wrap pg-hero" style="margin-top:64px">
  <p class="kicker">Vende con nosotros</p>
  <h1>Consigna tu Specialized</h1>
  <p class="lead">Deja tu bici en manos de Bike Trust. La certificamos, la mostramos a compradores que confían en nuestra marca y la vendemos por ti.</p>
  <p class="cite">«Tú nos confías la bici; nosotros ponemos la certificación, la vitrina y los compradores.»</p>
</section>

<section class="wrap" style="margin-top:56px">
  <div class="cards3">
    <div class="icard">
      <span class="n">01 · CONVERSAMOS</span>
      <h3>Cuéntanos qué tienes</h3>
      <p>Modelo, año y estado por WhatsApp. Te damos un rango de precio realista y te decimos si calza con lo que buscan nuestros compradores.</p>
    </div>
    <div class="icard">
      <span class="n">02 · CERTIFICAMOS</span>
      <h3>Pasa por el taller</h3>
      <p>La inspeccionamos, la afinamos y —si es eléctrica— le hacemos el diagnóstico digital. Queda con su puntaje /7 y su estado honesto declarado.</p>
    </div>
    <div class="icard">
      <span class="n">03 · PUBLICAMOS</span>
      <h3>La vitrina de Bike Trust</h3>
      <p>Entra al catálogo con ficha certificada y fotos reales. Tú no lidias con compradores, regateos ni visitas.</p>
    </div>
    <div class="icard">
      <span class="n">04 · TE PAGAMOS</span>
      <h3>Tu parte, sin complicaciones</h3>
      <p>Cuando se vende, te transferimos lo acordado.</p>
      <p class="fine">COMISIÓN Y CONDICIONES · POR ESCRITO AL ACORDAR LA CONSIGNA</p>
    </div>
  </div>
</section>

<section class="wrap" style="margin-top:64px">
  <div class="darkpanel">
    <img class="shadowlogo" src="/assets/brand/shield.png" alt="">
    <p class="kicker gold">Empieza hoy</p>
    <h2>¿Tienes una Specialized para vender?</h2>
    <p>Cuéntanos qué tienes y te damos una orientación de precio, sin compromiso.</p>
    <a class="btn-gold" href="${WA_CONSIGNA}" target="_blank" rel="noopener" style="margin-top:28px;align-self:flex-start;display:inline-flex;align-items:center;gap:10px">Conversemos por WhatsApp ↗</a>
  </div>
</section>

<section class="wrap" style="margin-top:56px">
  <div style="border-top:1px solid var(--linea3);padding-top:24px;display:flex;flex-wrap:wrap;gap:18px 40px;justify-content:space-between;align-items:baseline">
    <p style="margin:0;font-size:13px;color:var(--muted);max-width:52ch;line-height:1.7">¿Prefieres descontarla de tu próxima bici? También la recibimos <a href="${WA_PARTEPAGO}" target="_blank" rel="noopener">en parte de pago</a>.</p>
    <a class="lnk" href="/catalogo">Ver lo que ya está en vitrina →</a>
  </div>
</section>
${MSTICKY}
</div>
` + FOOT;
}

/* ---------- página: encargo ---------- */
const ENCARGO_JS = String.raw`(function(){
  var mod=document.getElementById('enc-modelo'), tal=document.getElementById('enc-talla'), pre=document.getElementById('enc-presupuesto'), btn=document.getElementById('enc-wa');
  if(!btn) return;
  function upd(){
    var m=(mod.value||'').trim()||'(modelo por definir)';
    var msg='Hola! Quiero encargar una Specialized '+m+', talla '+tal.value+', presupuesto '+pre.value+'. ¿Me avisan cuando la tengan?';
    btn.href='https://wa.me/` + WA_NUM + String.raw`?text='+encodeURIComponent(msg);
  }
  ['input','change'].forEach(function(ev){ mod.addEventListener(ev,upd); tal.addEventListener(ev,upd); pre.addEventListener(ev,upd); });
  try{ var m=new URLSearchParams(location.search).get('modelo'); if(m){ mod.value=m; } }catch(e){}
  upd();
})();`;

function encargoHTML(){
  return HEAD('Encargo · Te conseguimos tu Specialized · Bike Trust', {path:'/encargo'}) + TOPBAR('encargo') + `
<div style="min-height:100vh;display:flex;flex-direction:column">
<section class="wrap" style="margin-top:64px;text-align:center">
  <p class="kicker">Encargo Bike Trust</p>
  <h1 class="h-serif" style="margin:18px auto 0;font-size:clamp(40px,5.6vw,68px);line-height:1.05;max-width:18ch">Si no está, <em style="font-style:italic;color:var(--bronce)">la conseguimos.</em></h1>
  <p style="margin:20px auto 0;font-size:15.5px;line-height:1.7;color:var(--text);max-width:56ch">Buscamos tu Specialized en nuestra red de dueños y tiendas. Solo te ofrecemos lo que podemos certificar con nuestro propio estándar.</p>
</section>

<section class="wrap" style="margin-top:52px">
  <div class="cards3">
    <div class="icard">
      <span class="n">01</span>
      <h3 style="font-size:26px">Nos cuentas qué buscas</h3>
      <p style="font-size:13.5px">Modelo, talla y presupuesto. Con eso basta para empezar la búsqueda.</p>
    </div>
    <div class="icard">
      <span class="n">02</span>
      <h3 style="font-size:26px">La encontramos y la certificamos</h3>
      <p style="font-size:13.5px">Pasa por el taller: inspección multipunto, diagnóstico digital y estado honesto.</p>
    </div>
    <div class="icard">
      <span class="n">03</span>
      <h3 style="font-size:26px">Te avisamos primero</h3>
      <p style="font-size:13.5px">Antes de publicarla en el catálogo, la ves tú. Sin compromiso de compra.</p>
    </div>
  </div>
</section>

<section style="max-width:760px;margin:56px auto 0;padding:0 28px;width:100%;box-sizing:border-box">
  <div class="formbox">
    <div class="hd3"><span class="l">Arma tu encargo</span><span class="r">2 MINUTOS</span></div>
    <div class="bd3">
      <label>Modelo que buscas
        <input type="text" id="enc-modelo" placeholder="Ej: Stumpjumper EVO, Levo SL…">
      </label>
      <div class="g2">
        <label>Tu talla
          <select id="enc-talla">
            <option>No estoy seguro</option>
            <option>S1</option><option>S2</option><option>S3</option><option>S4</option><option>S5</option><option>S6</option>
            <option>XS</option><option>S</option><option>M</option><option>L</option><option>XL</option>
            <option>49–52 (ruta)</option><option>54–56 (ruta)</option><option>58–61 (ruta)</option>
          </select>
        </label>
        <label>Presupuesto
          <select id="enc-presupuesto">
            <option>Abierto</option>
            <option>Hasta $2.000.000</option>
            <option>$2M a $4M</option>
            <option>$4M a $6M</option>
            <option>$6M a $10M</option>
            <option>Sobre $10M</option>
          </select>
        </label>
      </div>
      <a class="btn-dark" id="enc-wa" href="${wa('Hola! Quiero encargar una Specialized (modelo por definir), talla No estoy seguro, presupuesto Abierto. ¿Me avisan cuando la tengan?')}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:10px;padding:18px 24px;margin-top:6px;font-size:12px">Enviar encargo por WhatsApp <span style="font-size:14px">↗</span></a>
      <p class="fine">TE AVISAMOS PRIMERO · SIN COMPROMISO</p>
    </div>
  </div>
  <p style="margin:22px 0 0;text-align:center;font-size:13px;line-height:1.7;color:var(--muted)">¿Prefieres mirar lo que ya está certificado? <a href="/catalogo">Ver el catálogo</a></p>
</section>
${MSTICKY}
</div>
<script>${ENCARGO_JS}</script>
` + FOOT;
}

/* ---------- página: guías ---------- */
function guiasHTML(){
  return HEAD('Guías · Antes de comprar · Bike Trust', {path:'/guias'}) + TOPBAR('guias') + `
<div style="min-height:100vh;display:flex;flex-direction:column" class="guia">
<section style="max-width:760px;margin:64px auto 0;padding:0 28px;width:100%;box-sizing:border-box">
  <p class="kicker">Antes de comprar</p>
  <h1 class="h-serif" style="margin:18px 0 0;font-size:clamp(38px,5vw,58px);line-height:1.06">Guías Bike Trust</h1>
  <p style="margin:18px 0 0;font-size:15px;line-height:1.7;color:var(--text)">Lo que conviene saber para elegir tu próxima Specialized usada, contado sin letra chica.</p>
  <nav class="guia-nav">
    <a href="#diagnostico"><span class="n">01</span><span class="t">Cómo leer el diagnóstico de una e-bike usada</span></a>
    <a href="#electrica"><span class="n">02</span><span class="t">Eléctrica o muscular: cómo elegir</span></a>
    <a href="#honesto"><span class="n">03</span><span class="t">Qué es el «estado honesto»</span></a>
  </nav>
</section>

<article id="diagnostico" style="max-width:760px;margin:72px auto 0;padding:0 28px;width:100%;box-sizing:border-box">
  <p class="mono" style="margin:0;font-size:10.5px;letter-spacing:.2em;color:var(--meta)">GUÍA 01</p>
  <h2>Cómo leer el diagnóstico de una e-bike usada</h2>
  <p class="body first">El sistema de una e-bike Specialized guarda tres datos que no mienten: los kilómetros del motor, la salud de la batería y los ciclos de carga. A diferencia del odómetro de una app —que se puede reiniciar—, estos se leen directamente de la electrónica de la bici.</p>
  <div class="box">
    <p><b style="font-weight:600">Km del motor.</b> El uso real acumulado. Importa más que el año de la bici: una 2022 con 1.500 km está menos usada que una 2024 con 6.000.</p>
    <p><b style="font-weight:600">Salud de batería.</b> Cuánta capacidad conserva respecto a la original. Sobre 90% es excelente; bajo 85% conviene reflejarlo en el precio.</p>
    <p><b style="font-weight:600">Ciclos de carga.</b> Cuántas cargas completas equivalentes lleva la batería. Junto a la salud, cuenta la historia de cómo se cuidó.</p>
  </div>
  <p class="body">La pregunta clave al comprar usado: ¿estos datos están <em>medidos</em> o <em>estimados</em>? En Bike Trust los escaneamos en el taller y van tal cual en la ficha de cada e-bike.</p>
</article>

<article id="electrica" style="max-width:760px;margin:72px auto 0;padding:0 28px;width:100%;box-sizing:border-box">
  <p class="mono" style="margin:0;font-size:10.5px;letter-spacing:.2em;color:var(--meta)">GUÍA 02</p>
  <h2>Eléctrica o muscular: cómo elegir</h2>
  <p class="body first">No es una discusión de purismo: es una pregunta sobre tu semana real. ¿Cuánto desnivel tienen tus rutas y cuánto tiempo tienes para pedalear? Si la respuesta es «mucho cerro, poco tiempo», la asistencia eléctrica te multiplica las salidas: subes en la mitad del tiempo y repites bajada.</p>
  <p class="body">La muscular gana en simpleza: menos mantención, menos peso, menor precio de entrada, y ninguna dependencia de batería. Si tus rutas son planas o el rito de subir es parte del gusto, sigue siendo la elección honesta.</p>
  <p class="body">El presupuesto cambia el tablero en usado: una e-bike certificada de segunda mano suele costar lo mismo que una muscular nueva de gama media. Por eso conviene mirar el diagnóstico digital antes que el año del modelo. Y si dudas entre dos, <a href="${WA_ASESORIA}" target="_blank" rel="noopener">cuéntanos cómo pedaleas</a> y te asesoramos.</p>
</article>

<article id="honesto" style="max-width:760px;margin:72px auto 0;padding:0 28px;width:100%;box-sizing:border-box">
  <p class="mono" style="margin:0;font-size:10.5px;letter-spacing:.2em;color:var(--meta)">GUÍA 03</p>
  <h2>Qué es el «estado honesto»</h2>
  <p class="body first">El riesgo de comprar usado no es el desgaste: es la información que no te dan. Una bici con tres rayones declarados es una compra tranquila; una «impecable» sin detalle es una apuesta.</p>
  <p class="body">Por eso cada ficha Bike Trust incluye su estado honesto: una lista numerada de cada rayón, marca o detalle real de esa unidad, escrita por el mecánico que la inspeccionó. Lo declaramos antes de que preguntes, y el precio ya lo considera.</p>
  <p class="body">El desgaste normal —pastillas, neumáticos, cadena— también se declara y se mide dentro del puntaje /7. Así comparas bicis con la misma vara, no con fotos favorecedoras.</p>
</article>

<section style="max-width:760px;margin:72px auto 0;padding:0 28px;width:100%;box-sizing:border-box">
  <div style="border:1px solid var(--linea3);background:var(--crema);padding:32px 30px;text-align:center">
    <h2 class="h-serif" style="margin:0;font-size:clamp(24px,3vw,32px)">¿Te quedó una duda concreta?</h2>
    <p style="margin:10px auto 0;font-size:13.5px;color:var(--text);max-width:44ch">Pregúntanos directo. Respondemos con datos, no con discurso de venta.</p>
    <a class="btn-dark" href="${WA_GUIAS}" target="_blank" rel="noopener" style="margin-top:22px;padding:15px 28px">Pregunta por WhatsApp ↗</a>
  </div>
</section>
${MSTICKY}
</div>
` + FOOT;
}

/* ---------- 404 ---------- */
function notFoundHTML(){
  return HEAD('Página no encontrada · Bike Trust', {path:'/404'}) + TOPBAR('') + `
<main style="max-width:640px;margin:0 auto;padding:90px 24px 110px;text-align:center">
  <p class="kicker">Error 404</p>
  <h1 class="h-serif" style="margin:16px 0 0;font-size:clamp(32px,4vw,44px);line-height:1.15">Esta bici ya no está disponible</h1>
  <p style="margin:16px 0 0;color:var(--muted);font-size:15px;line-height:1.7">Puede que se haya vendido, o que el enlace haya cambiado. Pero tenemos más Specialized certificadas esperándote.</p>
  <a class="btn-dark" href="/catalogo" style="margin-top:30px">Ver el catálogo</a>
  <div style="margin-top:18px"><a href="/" style="font-size:.9rem">Volver al inicio</a></div>
</main>` + FOOT;
}

/* ---------- SEO + redirecciones ---------- */
// sitemap.xml con todas las URLs limpias (home, páginas, guías, fichas).
function sitemapXML(bikes){
  const today = new Date().toISOString().slice(0,10);
  const urls = ['/', '/catalogo', '/encargo', '/como-certificamos', '/consigna', '/guias',
    ...bikes.map(b=>`/bici/${b.slug}`)];
  const body = urls.map(u=>`  <url><loc>${SITE}${u}</loc><lastmod>${today}</lastmod></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

// URLs del sitio anterior → sus equivalentes en el rediseño (Cloudflare Pages _redirects).
const REDIRECTS = `# Rediseño 2026-08: páginas que cambiaron de lugar
/visitanos / 301
/visitanos.html / 301
/guias/leer-diagnostico /guias#diagnostico 301
/guias/leer-diagnostico.html /guias#diagnostico 301
/guias/electrica-o-muscular /guias#electrica 301
/guias/electrica-o-muscular.html /guias#electrica 301
/guias/estado-honesto /guias#honesto 301
/guias/estado-honesto.html /guias#honesto 301
`;

// ---------- Ficha técnica imprimible (auto-generada, A4, print-to-PDF) ----------
// ⚠ Esta es la página que el bot de ManyChat manda por DM (/ficha/<slug>). NO tocar sin revisar mc-match.
const FICHA_CSS = `
:root{--bronce:#A88454;--tinta:#1a1a1a;--gris:#6b6b6b;--linea:#e6e1d8;--hueso:#faf8f4}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Jost',sans-serif;color:var(--tinta);background:#d9d6d0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:13px 22px;background:#fff;border-bottom:1px solid var(--linea);box-shadow:0 1px 8px rgba(0,0,0,.06)}
.toolbar a{color:var(--gris);text-decoration:none;font-size:.85rem}
.toolbar .tb-brand{color:var(--gris);font-size:.8rem;letter-spacing:.1em}
.toolbar .tb-brand b{color:var(--bronce)}
.toolbar button{background:var(--bronce);color:#fff;border:0;padding:11px 24px;font-family:'Jost',sans-serif;font-weight:500;letter-spacing:.05em;cursor:pointer;font-size:.84rem}
.sheet{width:210mm;min-height:297mm;margin:26px auto;background:#fff;padding:18mm 16mm;box-shadow:0 8px 36px rgba(0,0,0,.2)}
.brandbar{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid var(--bronce);padding-bottom:12px;margin-bottom:20px}
.brandbar .lock{display:flex;align-items:center;gap:9px}
.brandbar .shield{width:25px;height:29px;fill:var(--bronce)}
.brandbar .bn{font-weight:600;letter-spacing:.14em;font-size:.92rem}
.brandbar .bn b{color:var(--bronce)}
.brandbar .doc{font-size:.64rem;letter-spacing:.18em;text-transform:uppercase;color:var(--gris)}
h1{font-family:'Cormorant Garamond',serif;font-weight:600;font-size:2.4rem;line-height:1.04}
.sub{color:var(--gris);font-size:.9rem;margin-top:4px;letter-spacing:.02em}
.intro{font-family:'Cormorant Garamond',serif;font-style:italic;font-size:1.08rem;color:var(--gris);margin:14px 0 4px;line-height:1.4}
.hero{width:100%;height:80mm;object-fit:cover;background:var(--hueso);border:1px solid var(--linea);margin:18px 0 20px}
.hero.ph{display:flex;align-items:center;justify-content:center}
.shbig{width:46px;height:52px;fill:var(--linea)}
.row2{display:grid;grid-template-columns:1.6fr 1fr;gap:22px;margin-bottom:8px}
.kv{width:100%;border-collapse:collapse;font-size:.85rem}
.kv td{padding:7px 0;border-bottom:1px solid var(--linea)}
.kv td:first-child{color:var(--gris);width:46%}
.kv td:last-child{text-align:right;font-weight:500}
.cert{background:var(--hueso);border:1px solid var(--linea);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px}
.cert .score{font-family:'Cormorant Garamond',serif;font-size:3.2rem;font-weight:600;color:var(--bronce);line-height:1}
.cert .clbl{font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;color:var(--gris);margin-top:6px;text-align:center}
.sec{margin-top:20px;break-inside:avoid}
.sec h2{font-weight:600;font-size:.7rem;letter-spacing:.16em;text-transform:uppercase;color:var(--bronce);border-bottom:1px solid var(--linea);padding-bottom:6px;margin-bottom:11px}
.diag{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.diag .d{background:var(--hueso);border:1px solid var(--linea);padding:13px 10px;text-align:center}
.diag .dv{font-family:'Cormorant Garamond',serif;font-size:1.7rem;font-weight:600}
.diag .dl{font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:var(--gris);margin-top:4px}
.honest{list-style:none}
.honest li{font-size:.85rem;margin:5px 0;padding-left:15px;position:relative}
.honest li:before{content:'—';position:absolute;left:0;color:var(--bronce)}
.sb{margin-bottom:11px;break-inside:avoid}
.sb h3{font-size:.82rem;font-weight:600;margin-bottom:3px}
.sr{display:flex;justify-content:space-between;font-size:.82rem;padding:4px 0;border-bottom:1px dotted var(--linea)}
.sr span:first-child{color:var(--gris)}
.foot{margin-top:26px;border-top:2px solid var(--bronce);padding-top:11px;display:flex;justify-content:space-between;font-size:.7rem;color:var(--gris)}
@media print{ body{background:#fff} .toolbar{display:none} .sheet{width:auto;min-height:auto;margin:0;padding:12mm 13mm;box-shadow:none} @page{size:A4;margin:0} }
`;

function fichaTecnicaHTML(b){
  const motor = b.electrica ? 'Eléctrica' : 'Muscular';
  const hero = (b.fotos && b.fotos[0])
    ? `<img class="hero" src="${esc(b.fotos[0])}" alt="${esc(b.marca+' '+b.modelo)}">`
    : `<div class="hero ph"><svg class="shbig"><use href="#sh"/></svg></div>`;
  const kv = [
    ['Marca', b.marca||'—'], ['Modelo', b.modelo||'—'], ['Año', b.anio||'—'],
    ['Disciplina', b.disciplina||'—'], ['Motorización', motor], ['Talla', b.talla||'—'],
    ['Rango de altura', b.rangoAltura||'—'], ['Material del cuadro', b.material||'—'],
    ['Referencia', b.referencia||'—'], ['Precio Bike Trust', b.precio?clp(b.precio):'—'],
    ['Valor de nueva', b.precioNuevo?clp(b.precioNuevo):'—']
  ].map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
  const cert = (b.puntaje!=null && b.puntaje!=='')
    ? `<div class="score">${esc(b.puntaje)}<span style="font-size:1.4rem;color:var(--gris)"> / 7</span></div><div class="clbl">Puntaje de certificación</div>`
    : `<div class="score">✓</div><div class="clbl">Certificada por Bike Trust</div>`;
  const desg = (b.desglose && b.desglose.length)
    ? `<div class="sec"><h2>Desglose de la certificación</h2>${b.desglose.map(([k,v])=>`<div class="sr"><span>${esc(k||'Ítem')}</span><span>${esc(v)}</span></div>`).join('')}</div>` : '';
  const diag = b.electrica
    ? `<div class="sec"><h2>Diagnóstico de e-bike</h2><div class="diag">
        <div class="d"><div class="dv">${b.diagKm!=null?esc(b.diagKm)+' km':'—'}</div><div class="dl">Km del motor</div></div>
        <div class="d"><div class="dv">${b.diagBat!=null?esc(b.diagBat)+'%':'—'}</div><div class="dl">Salud de batería</div></div>
        <div class="d"><div class="dv">${b.diagCic!=null?esc(b.diagCic):'—'}</div><div class="dl">Ciclos de carga</div></div>
      </div></div>` : '';
  const honest = (b.estado && b.estado.length)
    ? `<div class="sec"><h2>Estado honesto</h2><ul class="honest">${b.estado.map(l=>`<li>${esc(l)}</li>`).join('')}</ul></div>` : '';
  const blocks = g => g.map(x=>`<div class="sb"><h3>${esc(x.grupo)}</h3>${x.filas.map(f=>`<div class="sr"><span>${esc(f[0])}</span><span>${esc(f[1])}</span></div>`).join('')}</div>`).join('');
  const specs = (b.specs && b.specs.length) ? `<div class="sec"><h2>Especificaciones</h2>${blocks(b.specs)}</div>` : '';
  const geo = (b.geometria && b.geometria.length) ? `<div class="sec"><h2>Geometría</h2>${blocks(b.geometria)}</div>` : '';
  const intro = b.porQue ? `<p class="intro">${esc(b.porQue)}</p>` : '';
  const today = new Date().toLocaleDateString('es-CL',{year:'numeric',month:'long',day:'numeric'});
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>Ficha técnica · ${esc(b.marca+' '+b.modelo)} · Bike Trust</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Jost:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>${FICHA_CSS}</style></head><body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="sh" viewBox="0 0 32 36"><path d="M4 6 Q4 3 7 3 H25 Q28 3 28 6 V20 Q28 23.5 25.4 25.2 L16 32 L6.6 25.2 Q4 23.5 4 20 Z"/></symbol></svg>
<div class="toolbar"><span class="tb-brand"><b>BIKE</b> TRUST · Ficha técnica</span><button onclick="window.print()">Descargar PDF</button></div>
<article class="sheet">
  <div class="brandbar"><div class="lock"><svg class="shield"><use href="#sh"/></svg><span class="bn"><b>BIKE</b> TRUST</span></div><div class="doc">Ficha técnica · Certificado</div></div>
  <h1>${esc(b.marca)} ${esc(b.modelo)}</h1>
  <div class="sub">${esc(b.disciplina||'')} · ${esc(motor)}${b.talla?' · Talla '+esc(b.talla):''}${b.anio?' · '+esc(b.anio):''}</div>
  ${intro}
  ${hero}
  <div class="row2"><table class="kv">${kv}</table><div class="cert">${cert}</div></div>
  ${desg}${diag}${honest}${specs}${geo}
  <div class="foot"><span>Certificada por Bike Trust · Santiago, Chile</span><span>Emitida ${esc(today)} · biketrust.cl</span></div>
</article></body></html>`;
}

/* ---------- build ---------- */
// Asigna un slug único a cada bici. Sin colisión, la URL queda estable
// (modelo-talla); si dos comparten modelo+talla, se desambigua con -2, -3, …
// ⚠ Las Disponibles van PRIMERO en el array: así conservan el slug sin sufijo
// (mismo contrato que mc-match, que reconstruye slug(modelo-talla)).
function assignSlugs(bikes){
  const usados=new Map();
  for(const b of bikes){
    let base=slug(`${b.modelo}-${b.talla}`) || 'bici';
    let s=base, n=1;
    while(usados.has(s)){ s=`${base}-${++n}`; }
    usados.set(s,true);
    b.slug=s;
  }
}

// Descarga un adjunto de Airtable y lo aloja en /dist. Devuelve la ruta local o null.
async function saveAttachment(a, slug, n){
  if(!a || !a.url) return null;
  try{
    const r=await fetch(a.url);
    if(!r.ok) throw new Error('HTTP '+r.status);
    const buf=Buffer.from(await r.arrayBuffer());
    const ext=((a.type||'').split('/')[1]||'jpg').replace('jpeg','jpg').replace(/[^a-z0-9]/g,'')||'jpg';
    const rel=`assets/bikes/${slug}/${n}.${ext}`;
    await mkdir(`${OUT}/assets/bikes/${slug}`,{recursive:true});
    await writeFile(`${OUT}/${rel}`, buf);
    return '/'+rel;
  }catch(e){ console.warn(`⚠  foto ${slug} #${n} no descargada:`, e.message); return null; }
}

// Resuelve b.fotos: «Fotos galería» primero; respaldos: slots «Foto 1..13» y «Fotos URLs».
// Defensivo: nunca rompe el build.
async function resolveBikePhotos(bikes){
  let downloaded=0;
  for(const b of bikes){
    const out=[];
    // Prioridad: «Fotos galería» (campo único multi-adjunto que usan el form, la interfaz y el sitio).
    for(let i=0;i<b.fotosAdjuntos.length && i<13;i++){
      const local=await saveAttachment(b.fotosAdjuntos[i], b.slug, out.length+1);
      if(local){ out.push(local); downloaded++; }
    }
    if(!out.length){                                             // respaldo: slots «Foto 1..13»
      for(const slot of b.fotoSlots){
        if(!slot) continue;
        if(Array.isArray(slot) && slot[0] && slot[0].url){        // adjunto en el slot
          const local=await saveAttachment(slot[0], b.slug, out.length+1);
          if(local){ out.push(local); downloaded++; }
        } else if(typeof slot==='string' && slot.trim()){         // URL en texto
          out.push(slot.trim());
        }
      }
    }
    if(!out.length) out.push(...b.fotosBulk);                     // respaldo: «Fotos URLs»
    b.fotos = out;
  }
  if(downloaded) console.log(`  · ${downloaded} foto(s) descargada(s) desde Airtable`);
}

async function main(){
  const disponibles = await fetchBikes();                        // vista Disponibles (orden curado)
  const vistos = new Set(disponibles.map(b=>b.recId));
  const extras = (await fetchNoDisponibles()).filter(b=>!vistos.has(b.recId));
  const reservadasEstado = extras.filter(esReservada);
  const vendidas = extras.filter(esVendida)
    .sort((a,b)=> String(b.fechaVenta).localeCompare(String(a.fechaVenta)) || a.modelo.localeCompare(b.modelo));
  // Orden del catálogo: disponibles → reservadas con seña → vendidas (al final, en gris).
  const bikes = [...disponibles, ...reservadasEstado, ...vendidas];
  assignSlugs(bikes);
  const reservadas = await fetchReservedSlugs();
  for(const b of bikes) b.reservada = !esVendida(b) && reservadas.has(b.slug);
  if(vendidas.length) console.log(`  · ${vendidas.length} bici(s) vendidas publicadas en gris`);
  if(reservadas.size) console.log(`  · ${reservadas.size} modelo(s) con visita agendada`);
  await rm(OUT,{recursive:true,force:true});
  await mkdir(`${OUT}/bici`,{recursive:true});
  await mkdir(`${OUT}/ficha`,{recursive:true});
  await cp('assets/img', `${OUT}/assets/img`, {recursive:true}).catch(e=>console.warn('⚠  assets/img no copiado:', e.message));
  await cp('assets/brand', `${OUT}/assets/brand`, {recursive:true}).catch(e=>console.warn('⚠  assets/brand no copiado:', e.message));
  await resolveBikePhotos(bikes);
  await writeFile(`${OUT}/styles.css`, CSS);
  await writeFile(`${OUT}/index.html`, homeHTML(bikes));
  await writeFile(`${OUT}/catalogo.html`, catalogoHTML(bikes));
  await writeFile(`${OUT}/como-certificamos.html`, comoCertificamosHTML(bikes));
  await writeFile(`${OUT}/consigna.html`, consignaHTML());
  await writeFile(`${OUT}/encargo.html`, encargoHTML());
  await writeFile(`${OUT}/guias.html`, guiasHTML());
  for(const b of bikes){
    await writeFile(`${OUT}/bici/${b.slug}.html`, fichaHTML(b, bikes));
    await writeFile(`${OUT}/ficha/${b.slug}.html`, fichaTecnicaHTML(b));   // ficha técnica imprimible (la manda el bot)
  }
  // Producción / SEO: favicon (escudo), robots, sitemap, 404 on-brand y redirecciones del sitio anterior.
  await writeFile(`${OUT}/favicon.svg`, FAVICON);
  await writeFile(`${OUT}/robots.txt`, `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
  await writeFile(`${OUT}/sitemap.xml`, sitemapXML(bikes));
  await writeFile(`${OUT}/404.html`, notFoundHTML());
  await writeFile(`${OUT}/_redirects`, REDIRECTS);
  console.log(`✓ ${bikes.length} bici(s) (${disponibles.length} disponibles · ${vendidas.length} vendidas) · 6 páginas + fichas · +SEO (og, sitemap, robots, favicon, 404, _redirects) · sitio en /${OUT}`);
}
main().catch(e=>{ console.error(e); process.exit(1); });
