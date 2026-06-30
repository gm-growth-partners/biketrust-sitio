// build.mjs — Bike Trust · genera el sitio estático desde Airtable
// Lee la vista "Disponibles" y escribe /dist (catálogo + una ficha por bici).
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
  'Precio':4000000,'Estado':'Disponible',
  'Diag · km motor':1335,'Diag · salud batería':95,'Diag · ciclos':78,
  'Rango altura':'1,68–1,78 m','Referencia':'4054866',
  'Por qué amarla':'Sube las subidas más duras con energía de sobra. Baja las más largas como un misil.',
  'Specs clave':'# Motor y batería\nMotor: Specialized 2.1 · +410%\nBatería: M2-Series · 700 Wh\nApp: Mission Control\n# Suspensión y chasis\nHorquilla: RockShox Boxxer 180 mm\nRecorrido: 180 mm del / tras\nChasis: Aluminio M5 · Sidearm'
}];

/* ---------- helpers ---------- */
const num  = v => (v==null||v==='') ? null : Number(v);
const clp  = n => '$' + Number(n).toLocaleString('es-CL');
const esc  = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
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

// placeholder de imagen elegante (ícono de bici + textura) mientras no hay fotos
const BIKEICON = `<svg class="ph-ico" viewBox="0 0 80 50" aria-hidden="true"><circle cx="18" cy="34" r="12"/><circle cx="62" cy="34" r="12"/><path d="M18 34 L37 34 L51 13 L60 34"/><path d="M37 34 L47 13 L33 13"/><path d="M51 13 L47 13"/></svg>`;
const imgPH = label => `<div class="imgph">${BIKEICON}${label?`<span class="ph-t">${esc(label)}</span>`:''}</div>`;
// foto de stock por disciplina (tiles del home)
function discImg(d){
  const k = String(d).toLowerCase();
  if(k.includes('ruta') || k.includes('road')) return 'disc-ruta.jpg';
  if(k.includes('urban')) return 'disc-urbana.jpg';
  return 'disc-mtb.jpg';
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
    diagKm:num(f['Diag · km motor']), diagBat:num(f['Diag · salud batería']), diagCic:num(f['Diag · ciclos']),
    rangoAltura:f['Rango altura']||'', porQue:f['Por qué amarla']||'',
    estado:String(f['Estado honesto']||'').split('\n').map(s=>s.trim()).filter(Boolean),
    specs:parseSpecs(f['Specs clave']),
    geometria:parseSpecs(f['Geometría']),
    referencia:f['Referencia']||'',
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
  if(!TOKEN){ console.warn('⚠  Sin AIRTABLE_TOKEN — usando datos de ejemplo (mock).'); return MOCK.map(mapBike); }
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

/* ---------- CSS (identidad Bike Trust) ---------- */
const CSS = `
:root{--carbon:#0F0F0F;--carbon-true:#050505;--bronce:#A88454;--bronce-deep:#8C6E43;--blanco:#FFFFFF;--hueso:#FAF8F4;--gris:#6E6A63;--linea:#E8E2D8;--serif:'Cormorant Garamond',Georgia,serif;--sans:'Jost',system-ui,sans-serif}
*{margin:0;padding:0;box-sizing:border-box}
body{background:#EDE9E2;font-family:var(--sans);font-weight:300;color:var(--carbon);-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.shield{width:20px;height:23px;flex:none}.shield path{fill:none;stroke:var(--bronce);stroke-width:1.6}
.wrap{max-width:1080px;margin:0 auto;padding:0 28px}
.topbar{background:var(--blanco);border-bottom:1px solid var(--linea)}
.topbar .in{display:flex;align-items:center;justify-content:space-between;padding:18px 28px;max-width:1080px;margin:0 auto}
.lock{display:flex;align-items:center;gap:11px}.lock span{font-family:var(--serif);font-weight:600;font-size:1rem;letter-spacing:.16em;text-transform:uppercase}.lock b{color:var(--bronce)}
.topbar .nav{font-size:.7rem;letter-spacing:.22em;text-transform:uppercase;color:var(--gris)}
/* catálogo */
.hero{background:var(--blanco);text-align:center;padding:74px 28px 60px;border-bottom:1px solid var(--linea)}
.hero .eyebrow{font-size:.7rem;letter-spacing:.36em;text-transform:uppercase;color:var(--bronce)}
.hero h1{font-family:var(--serif);font-weight:500;font-size:clamp(2.6rem,6vw,4rem);line-height:1.05;margin:16px 0}
.hero p{color:var(--gris);max-width:48ch;margin:0 auto}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:24px;padding:54px 0}
.card{background:var(--blanco);border:1px solid var(--linea);display:flex;flex-direction:column;transition:box-shadow .25s,transform .25s}
.card:hover{box-shadow:0 20px 50px rgba(15,15,15,.10);transform:translateY(-3px)}
.card .img{position:relative;height:200px;background:var(--hueso);overflow:hidden;display:flex;align-items:center;justify-content:center;border-bottom:1px solid var(--linea)}
.card .img img{width:100%;height:100%;object-fit:cover}
.card .img .ph{font-size:.66rem;letter-spacing:.2em;text-transform:uppercase;color:var(--bronce)}
.card .body{padding:20px 22px 22px;display:flex;flex-direction:column;gap:6px;flex:1}
.card .disc{font-size:.62rem;letter-spacing:.2em;text-transform:uppercase;color:var(--gris)}
.card h3{font-family:var(--serif);font-weight:600;font-size:1.4rem;line-height:1.1}
.card .meta{font-size:.8rem;color:var(--gris)}
.card .foot{margin-top:auto;display:flex;align-items:center;justify-content:space-between;padding-top:14px}
.card .price{font-family:var(--serif);font-weight:600;font-size:1.5rem}
.card .badge{display:flex;align-items:center;gap:6px;font-size:.6rem;letter-spacing:.16em;text-transform:uppercase;color:var(--bronce)}
.empty{padding:80px 0;text-align:center;color:var(--gris)}
/* ficha */
.ficha{max-width:760px;margin:34px auto;background:var(--blanco);box-shadow:0 30px 80px rgba(15,15,15,.10)}
.title{padding:34px 46px 22px}
.title .kicker{font-size:.72rem;letter-spacing:.3em;text-transform:uppercase;color:var(--gris);margin-bottom:12px}
.title h1{font-family:var(--serif);font-weight:500;font-size:clamp(2.3rem,6vw,3.4rem);line-height:1}
.title .brandname{display:block;font-size:.5em;letter-spacing:.06em;color:var(--bronce);font-weight:600;text-transform:uppercase;margin-bottom:6px}
.ph-box{border:1.5px dashed var(--bronce);background:var(--hueso);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--bronce);gap:4px}
.ph-box .pl{font-size:.72rem;letter-spacing:.22em;text-transform:uppercase;font-weight:500}.ph-box .pd{font-size:.7rem;color:var(--gris)}
.hero-ph{height:330px;margin:0 46px;overflow:hidden}.hero-ph img{width:100%;height:100%;object-fit:cover}
.gallery{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;padding:10px 46px 0}.gallery .ph-box,.gallery img{height:104px}.gallery img{width:100%;object-fit:cover}
.price{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;padding:34px 46px 30px;flex-wrap:wrap}
.price .anchor{font-size:.82rem;color:var(--gris)}.price .anchor s{text-decoration-color:var(--bronce)}
.pend{display:inline-block;font-size:.6rem;letter-spacing:.14em;text-transform:uppercase;color:var(--bronce);border:1px solid var(--linea);border-radius:2px;padding:2px 7px;margin-left:6px}
.price .now{font-family:var(--serif);font-weight:600;font-size:3.1rem;line-height:.9;margin-top:4px}
.price .cert{display:flex;align-items:center;gap:9px;background:var(--hueso);border:1px solid var(--linea);border-radius:3px;padding:11px 15px}
.price .cert .s{font-family:var(--serif);font-weight:600;font-size:1.5rem;color:var(--bronce)}
.price .cert .l{font-size:.64rem;letter-spacing:.14em;text-transform:uppercase;color:var(--gris);line-height:1.3}
.cta{display:block;width:auto;text-align:center;background:var(--carbon);color:#fff;border:0;cursor:pointer;font-family:var(--sans);font-weight:500;letter-spacing:.18em;text-transform:uppercase;font-size:.78rem;padding:17px;margin:0 46px}.cta:hover{background:var(--bronce-deep)}
.ribbon{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--linea);border-bottom:1px solid var(--linea);margin-top:30px}
.ribbon div{padding:16px 10px;text-align:center;border-left:1px solid var(--linea)}.ribbon div:first-child{border-left:0}
.ribbon .k{font-size:.62rem;letter-spacing:.18em;text-transform:uppercase;color:var(--gris)}.ribbon .v{font-family:var(--serif);font-weight:600;font-size:1.1rem;margin-top:4px}
.why{padding:40px 46px;text-align:center}.why .src{font-size:.68rem;letter-spacing:.2em;text-transform:uppercase;color:var(--bronce);margin-bottom:16px}
.why p{font-family:var(--serif);font-style:italic;font-size:clamp(1.4rem,3.4vw,1.9rem);line-height:1.3}
.diag{background:var(--carbon-true);color:#F3EDE4;padding:40px 46px}
.diag .head{display:flex;align-items:center;gap:11px;justify-content:center;margin-bottom:30px}.diag .head span{font-size:.72rem;letter-spacing:.3em;text-transform:uppercase;color:var(--bronce)}
.diag .g{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;text-align:center}
.diag .n{font-family:var(--serif);font-weight:600;font-size:2.7rem;line-height:1;color:var(--bronce)}.diag .u{font-size:.72rem;margin-top:4px}.diag .l{font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;color:#9a948a;margin-top:9px}
.diag .foot{text-align:center;font-size:.7rem;color:#9a948a;margin-top:26px}
.sec{padding:38px 46px}.sec .lead{font-size:.72rem;letter-spacing:.22em;text-transform:uppercase;color:var(--bronce);margin-bottom:18px}
.honest{background:var(--hueso);border:1px solid var(--linea);border-radius:3px;padding:24px 26px}
.honest ul{list-style:none}.honest li{display:flex;gap:11px;align-items:flex-start;padding:7px 0;font-size:.95rem}.honest li::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--bronce);margin-top:9px;flex:none}
.honest .note{font-size:.74rem;color:var(--gris);font-style:italic;margin-top:10px}
.specs{display:grid;grid-template-columns:1fr 1fr;gap:0 40px}.specs .blk{padding:6px 0 14px}
.specs h3{font-size:.66rem;letter-spacing:.2em;text-transform:uppercase;color:var(--bronce);font-weight:500;padding-bottom:8px;border-bottom:1px solid var(--linea);margin-bottom:6px}
.specs .row{display:flex;justify-content:space-between;gap:14px;padding:6px 0;font-size:.88rem;border-bottom:1px solid var(--linea)}.specs .row span:first-child{color:var(--gris)}
.certblk{background:var(--carbon-true);color:#F3EDE4;padding:40px 46px}
.certblk .head{display:flex;align-items:center;gap:11px;margin-bottom:8px}.certblk .head h2{font-family:var(--serif);font-weight:500;font-size:1.7rem}
.certblk .sub{font-size:.72rem;letter-spacing:.24em;text-transform:uppercase;color:var(--bronce);margin-bottom:22px}
.certblk .checks{display:grid;grid-template-columns:1fr 1fr;gap:10px 26px}.certblk .checks div{display:flex;gap:10px;align-items:center;font-size:.9rem}.certblk .checks div::before{content:"";width:16px;height:16px;flex:none;border:1.5px solid var(--bronce);border-radius:50%;background:radial-gradient(circle at 50% 55%,var(--bronce) 0 2px,transparent 2px)}
.certblk .promise{margin-top:24px;padding-top:20px;border-top:1px solid #2a2722;font-size:.84rem;color:#cfc8bd;line-height:1.6;text-align:justify}
.back{display:inline-block;padding:24px 46px 0;font-size:.72rem;letter-spacing:.2em;text-transform:uppercase;color:var(--gris)}
.foot{padding:26px 46px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;border-top:1px solid var(--linea)}
.foot .c{font-size:.72rem;color:var(--gris);text-align:right;line-height:1.6}
.hidden{display:none}
@media (max-width:620px){.specs,.certblk .checks{grid-template-columns:1fr}.price .now{font-size:2.6rem}}
@media print{body{background:#fff}.ficha{box-shadow:none}.rsv-ov,.rsv-open{display:none!important}}
/* ---------- reserva (modal de agendamiento) ---------- */
.rsv-open{display:inline-block;margin-top:28px;background:var(--carbon);color:#fff;border:0;cursor:pointer;font-family:var(--sans);font-weight:500;letter-spacing:.18em;text-transform:uppercase;font-size:.74rem;padding:15px 32px;transition:background .2s}
.rsv-open:hover{background:var(--bronce-deep)}
.rsv-ov{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;padding:20px}
.rsv-ov.open{display:flex}
.rsv-ov-bg{position:absolute;inset:0;background:rgba(15,15,15,.55)}
.rsv{position:relative;background:var(--blanco);width:100%;max-width:520px;max-height:92vh;overflow:auto;box-shadow:0 30px 90px rgba(15,15,15,.32);display:flex;flex-direction:column}
.rsv-hd{display:flex;align-items:center;justify-content:space-between;padding:20px 26px;border-bottom:1px solid var(--linea);position:sticky;top:0;background:var(--blanco);z-index:2}
.rsv-ttl{display:flex;align-items:center;gap:10px;font-family:var(--serif);font-weight:600;font-size:1.3rem}
.rsv-x{background:none;border:0;font-size:1.7rem;line-height:1;color:var(--gris);cursor:pointer;padding:0 4px}
.rsv-x:hover{color:var(--carbon)}
.rsv-stepn{padding:15px 26px 0;font-size:.62rem;letter-spacing:.22em;text-transform:uppercase;color:var(--bronce)}
.rsv-bd{padding:16px 26px 8px}
.rsv-step{display:none}
.rsv-step.on{display:block}
.rsv-intro{font-size:.9rem;color:var(--gris);margin-bottom:18px;line-height:1.5}
.rsv-field{margin-bottom:16px}
.rsv-lbl{display:block;font-size:.64rem;letter-spacing:.18em;text-transform:uppercase;color:var(--gris);margin-bottom:7px}
.rsv-field input,.rsv-field select{width:100%;border:1px solid var(--linea);background:var(--hueso);padding:12px 13px;font-family:var(--sans);font-size:.95rem;color:var(--carbon);border-radius:2px}
.rsv-field input:focus,.rsv-field select:focus{outline:none;border-color:var(--bronce)}
.rsv-grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}
.rsv-count{color:var(--bronce);font-weight:500;letter-spacing:0}
.rsv-note{font-size:.78rem;color:var(--gris);font-style:italic;margin:2px 0 14px}
.rsv-models{max-height:228px;overflow:auto;border:1px solid var(--linea);border-radius:2px;margin-bottom:18px}
.rsv-model{display:flex;align-items:center;gap:12px;padding:11px 14px;border-bottom:1px solid var(--linea);cursor:pointer}
.rsv-model:last-child{border-bottom:0}
.rsv-model input{position:absolute;opacity:0;width:0;height:0}
.rsv-check{width:18px;height:18px;flex:none;border:1.5px solid var(--linea);border-radius:3px;position:relative}
.rsv-model.sel{background:var(--hueso)}
.rsv-model.sel .rsv-check{border-color:var(--bronce);background:var(--bronce)}
.rsv-model.sel .rsv-check::after{content:"";position:absolute;left:5px;top:1px;width:5px;height:10px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
.rsv-model.dis{opacity:.4;cursor:not-allowed}
.rsv-mtxt{display:flex;flex-direction:column;gap:1px}
.rsv-mname{font-size:.92rem}
.rsv-mmeta{font-size:.7rem;color:var(--gris)}
.rsv-err{color:#9a3b2f;font-size:.8rem;margin:-4px 0 12px}
.rsv-ft{display:flex;gap:10px;justify-content:flex-end;padding:16px 26px;border-top:1px solid var(--linea);position:sticky;bottom:0;background:var(--blanco)}
.rsv-btn{background:var(--carbon);color:#fff;border:0;cursor:pointer;font-family:var(--sans);font-weight:500;letter-spacing:.16em;text-transform:uppercase;font-size:.72rem;padding:13px 22px;transition:background .2s}
.rsv-btn:hover{background:var(--bronce-deep)}
.rsv-btn:disabled{opacity:.6;cursor:default}
.rsv-btn.ghost{background:none;color:var(--gris);border:1px solid var(--linea)}
.rsv-btn.ghost:hover{background:var(--hueso);color:var(--carbon)}
.rsv-ok{text-align:center;padding:22px 6px 12px}
.rsv-ok h3{font-family:var(--serif);font-weight:600;font-size:1.7rem;margin-bottom:10px}
.rsv-okmsg{color:var(--gris);font-size:.95rem;line-height:1.55}
.rsv-wa{display:inline-block;margin-top:18px;background:#25D366;color:#fff;padding:12px 22px;border-radius:3px;font-size:.82rem;letter-spacing:.03em}
@media (max-width:480px){.rsv-grid2{grid-template-columns:1fr}}
/* aviso "reservada" (visita agendada · urgencia, NO la quita de venta) */
.resv-tag{position:absolute;top:10px;left:10px;z-index:1;display:flex;align-items:center;gap:6px;background:rgba(168,132,84,.95);color:#fff;font-size:.56rem;letter-spacing:.16em;text-transform:uppercase;font-weight:500;padding:5px 9px;border-radius:2px}
.resv-tag::before{content:"";width:6px;height:6px;border-radius:50%;background:#fff;animation:resvPulse 1.6s ease-in-out infinite}
@keyframes resvPulse{0%,100%{opacity:1}50%{opacity:.3}}
.resv-note{display:flex;gap:11px;align-items:flex-start;margin:0 46px 14px;padding:13px 16px;background:var(--hueso);border:1px solid var(--linea);border-left:3px solid var(--bronce);font-size:.84rem;color:var(--carbon);line-height:1.45}
/* etiqueta "imagen referencial" (foto del modelo, no de la unidad real) */
.ref-tag{position:absolute;bottom:8px;left:8px;z-index:1;background:rgba(15,15,15,.62);color:#fff;font-size:.5rem;letter-spacing:.12em;text-transform:uppercase;padding:3px 7px;border-radius:2px}
.pgal-main.has-img{position:relative}
.ref-note{position:absolute;left:0;right:0;bottom:0;z-index:1;background:rgba(15,15,15,.6);color:#fff;font-size:.62rem;letter-spacing:.05em;text-align:center;padding:6px 10px}
.resv-note .d{flex:none;width:8px;height:8px;border-radius:50%;background:var(--bronce);margin-top:6px;animation:resvPulse 1.6s ease-in-out infinite}
.resv-note b{color:var(--bronce-deep);font-weight:600}
@media (max-width:620px){.resv-note{margin:0 24px 14px}}
/* ---------- landing (home estilo TPC · identidad Bike Trust) ---------- */
.nav2{position:sticky;top:0;z-index:50;background:var(--blanco);border-bottom:1px solid var(--linea)}
.nav2 .in{max-width:1180px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:15px 28px}
.nav2 .links{display:flex;align-items:center;gap:23px}
.nav2 .links a{font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:var(--gris)}
.nav2 .links a:hover{color:var(--carbon)}
.navcta{background:var(--carbon);color:#fff;border:0;cursor:pointer;font-family:var(--sans);font-weight:500;letter-spacing:.16em;text-transform:uppercase;font-size:.66rem;padding:11px 18px;transition:background .2s}
.navcta:hover{background:var(--bronce-deep)}
@media(max-width:640px){.nav2 .links a{display:none}}
.btn-primary{display:inline-block;background:var(--carbon);color:#fff;border:0;cursor:pointer;font-family:var(--sans);font-weight:500;letter-spacing:.16em;text-transform:uppercase;font-size:.74rem;padding:15px 30px;transition:background .2s}
.btn-primary:hover{background:var(--bronce-deep)}
.btn-ghost{display:inline-block;background:none;border:1px solid var(--carbon);color:var(--carbon);cursor:pointer;font-family:var(--sans);font-weight:500;letter-spacing:.16em;text-transform:uppercase;font-size:.74rem;padding:14px 29px;transition:all .2s}
.btn-ghost:hover{background:var(--carbon);color:#fff}
.btn-ghost.light{border-color:rgba(255,255,255,.55);color:#fff}
.btn-ghost.light:hover{background:#fff;color:var(--carbon)}
.lhero{background:var(--blanco);border-bottom:1px solid var(--linea);text-align:center;padding:96px 28px 84px;position:relative;overflow:hidden}
.lhero .shieldbg{position:absolute;left:50%;top:54%;transform:translate(-50%,-50%);width:460px;height:auto;opacity:.045;pointer-events:none}
.lhero .shieldbg path{fill:var(--bronce);stroke:none}
.lhero .eyebrow{position:relative;font-size:.72rem;letter-spacing:.36em;text-transform:uppercase;color:var(--bronce)}
.lhero h1{position:relative;font-family:var(--serif);font-weight:500;font-size:clamp(2.8rem,7vw,5rem);line-height:1.04;margin:18px 0 14px}
.lhero p{position:relative;color:var(--gris);max-width:52ch;margin:0 auto;font-size:1.02rem;line-height:1.6}
.lhero .ctas{position:relative;display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-top:34px}
.pillars{background:var(--hueso);border-bottom:1px solid var(--linea)}
.pillars .in{max-width:1080px;margin:0 auto;display:grid;grid-template-columns:repeat(4,1fr)}
.pillar{padding:38px 24px;text-align:center;border-left:1px solid var(--linea)}
.pillar:first-child{border-left:0}
.pillar svg{width:30px;height:30px;margin-bottom:14px}
.pillar svg [stroke],.pillar svg path,.pillar svg circle,.pillar svg line,.pillar svg polyline{stroke:var(--bronce);stroke-width:1.5;fill:none;stroke-linecap:round;stroke-linejoin:round}
.pillar h3{font-family:var(--serif);font-weight:600;font-size:1.15rem;margin-bottom:6px}
.pillar p{font-size:.8rem;color:var(--gris);line-height:1.5}
@media(max-width:760px){.pillars .in{grid-template-columns:1fr 1fr}.pillar{border-top:1px solid var(--linea)}.pillar:nth-child(1),.pillar:nth-child(2){border-top:0}.pillar:nth-child(3){border-left:0}}
@media(max-width:430px){.pillars .in{grid-template-columns:1fr}.pillar{border-left:0;border-top:1px solid var(--linea)}.pillar:first-child{border-top:0}}
.section{max-width:1180px;margin:0 auto;padding:0 28px}
.sec-head{text-align:center;padding:70px 0 6px}
.sec-head .eyebrow{font-size:.7rem;letter-spacing:.32em;text-transform:uppercase;color:var(--bronce)}
.sec-head h2{font-family:var(--serif);font-weight:500;font-size:clamp(2rem,4.5vw,2.8rem);margin-top:10px}
.sec-head p{color:var(--gris);max-width:50ch;margin:12px auto 0}
.filters{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;padding:26px 0 4px}
.chip{font-size:.66rem;letter-spacing:.14em;text-transform:uppercase;padding:9px 16px;border:1px solid var(--linea);background:var(--blanco);color:var(--gris);cursor:pointer;border-radius:2px;transition:all .15s}
.chip:hover{border-color:var(--bronce);color:var(--carbon)}
.chip.on{background:var(--carbon);color:#fff;border-color:var(--carbon)}
.steps{max-width:1000px;margin:0 auto;display:grid;grid-template-columns:repeat(3,1fr);gap:20px;padding:34px 28px 0}
.stepc{text-align:center;padding:26px 18px}
.stepc .num{font-family:var(--serif);font-weight:600;font-size:2.6rem;color:var(--bronce);line-height:1}
.stepc h3{font-family:var(--serif);font-weight:600;font-size:1.3rem;margin:10px 0 8px}
.stepc p{font-size:.88rem;color:var(--gris);line-height:1.55}
.steps-cta{text-align:center;padding:30px 0 0}
@media(max-width:720px){.steps{grid-template-columns:1fr;gap:8px}}
.ctaband{background:var(--carbon-true);color:#fff;text-align:center;padding:74px 28px;margin-top:70px}
.ctaband .eyebrow{font-size:.7rem;letter-spacing:.32em;text-transform:uppercase;color:var(--bronce)}
.ctaband h2{font-family:var(--serif);font-weight:500;font-size:clamp(2rem,4.5vw,2.8rem);margin:12px 0 10px}
.ctaband p{color:#cfc8bd;max-width:46ch;margin:0 auto 26px;line-height:1.6}
.foot2{background:var(--blanco);border-top:1px solid var(--linea)}
.foot2 .in{max-width:1180px;margin:0 auto;display:grid;grid-template-columns:1.6fr 1fr 1fr 1.3fr;gap:30px;padding:46px 28px}
.foot2 .ftag{font-size:.82rem;color:var(--gris);margin-top:12px;line-height:1.55;max-width:30ch}
.foot2 .fcol h4{font-size:.64rem;letter-spacing:.2em;text-transform:uppercase;color:var(--bronce);margin-bottom:14px}
.foot2 .fcol a,.foot2 .fcol .flink{display:block;font-size:.84rem;color:var(--gris);margin-bottom:9px;background:none;border:0;padding:0;cursor:pointer;font-family:var(--sans);letter-spacing:0;text-transform:none;text-align:left}
.foot2 .fcol a:hover,.foot2 .fcol .flink:hover{color:var(--carbon)}
.foot2 .fcontact{font-size:.84rem;color:var(--gris);line-height:1.75}
.foot2 .legal{border-top:1px solid var(--linea);text-align:center;font-size:.7rem;color:var(--gris);padding:16px 28px}
@media(max-width:680px){.foot2 .in{grid-template-columns:1fr 1fr;gap:26px}}@media(max-width:430px){.foot2 .in{grid-template-columns:1fr}}
.cc-hero{background:var(--carbon-true);color:#F3EDE4;text-align:center;padding:82px 28px 70px}
.cc-hero .eyebrow{font-size:.7rem;letter-spacing:.34em;text-transform:uppercase;color:var(--bronce)}
.cc-hero h1{font-family:var(--serif);font-weight:500;font-size:clamp(2.6rem,6vw,4rem);margin:16px 0 14px}
.cc-hero p{color:#cfc8bd;max-width:54ch;margin:0 auto;line-height:1.6}
.cc-intro{max-width:760px;margin:0 auto;text-align:center;padding:66px 28px 6px}
.cc-intro p{font-family:var(--serif);font-style:italic;font-size:clamp(1.3rem,3vw,1.7rem);line-height:1.42;color:var(--carbon)}
.cc-steps{max-width:1080px;margin:0 auto;padding:48px 28px 0;display:grid;grid-template-columns:1fr 1fr;gap:22px}
.cc-step{background:var(--blanco);border:1px solid var(--linea);padding:30px 28px}
.cc-step .n{font-family:var(--serif);font-weight:600;color:var(--bronce);font-size:1rem;letter-spacing:.1em}
.cc-step h3{font-family:var(--serif);font-weight:600;font-size:1.5rem;margin:6px 0 10px}
.cc-step p{font-size:.92rem;color:var(--gris);line-height:1.6}
@media(max-width:680px){.cc-steps{grid-template-columns:1fr}}
/* ===== home réplica estructural de The Pro's Closet (branding Bike Trust) ===== */
.annbar{background:var(--carbon-true);color:#F3EDE4;text-align:center;font-size:.72rem;letter-spacing:.05em;padding:10px 16px}
.annbar b{color:var(--bronce);font-weight:500}
.annbar .ab-link{color:#fff;text-decoration:underline;text-underline-offset:2px;margin-left:10px;cursor:pointer;background:none;border:0;font:inherit;letter-spacing:inherit}
.hcar{position:relative;overflow:hidden;background:var(--carbon-true);border-bottom:1px solid var(--linea)}
.hcar-track{display:flex;transition:transform .55s cubic-bezier(.5,0,.2,1)}
.hslide{min-width:100%;display:grid;grid-template-columns:1fr 1fr}
.hslide .htext{padding:76px 8% 76px max(28px,6%);color:#F3EDE4;display:flex;flex-direction:column;justify-content:center;align-items:flex-start}
.hslide .eyebrow{font-size:.7rem;letter-spacing:.32em;text-transform:uppercase;color:var(--bronce)}
.hslide h2{font-family:var(--serif);font-weight:500;font-size:clamp(2.2rem,4vw,3.5rem);line-height:1.06;margin:14px 0}
.hslide p{color:#cfc8bd;line-height:1.6;max-width:40ch;margin-bottom:28px}
.hslide .himg{position:relative;background:var(--hueso);overflow:hidden;min-height:480px;display:flex;align-items:center;justify-content:center}
.hslide .himg .ph{position:absolute;bottom:14px;font-size:.62rem;letter-spacing:.2em;text-transform:uppercase;color:var(--bronce);opacity:.8}
.hslide .himg svg{width:170px;height:auto;opacity:.13}.hslide .himg svg path{fill:var(--bronce);stroke:none}
.hprev,.hnext{position:absolute;top:50%;transform:translateY(-50%);z-index:3;background:rgba(255,255,255,.92);border:0;width:42px;height:42px;border-radius:50%;cursor:pointer;font-size:1.1rem;color:var(--carbon);display:flex;align-items:center;justify-content:center}
.hprev{left:16px}.hnext{right:16px}.hprev:hover,.hnext:hover{background:#fff}
.hdots{position:absolute;bottom:18px;left:0;right:0;display:flex;gap:8px;justify-content:center;z-index:3}
.hdot{width:8px;height:8px;border-radius:50%;border:0;background:rgba(255,255,255,.4);cursor:pointer;padding:0}.hdot.on{background:var(--bronce)}
@media(max-width:760px){.hslide{grid-template-columns:1fr}.hslide .himg{min-height:230px;order:-1}.hslide .htext{padding:46px 28px}.hslide .himg svg{width:120px}}
.pcar{position:relative;max-width:1180px;margin:0 auto;padding:0 28px}
.pcar-track{display:flex;gap:22px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;padding:6px 2px 12px;-ms-overflow-style:none;scrollbar-width:none}
.pcar-track::-webkit-scrollbar{display:none}
.pcar-track .card{min-width:286px;max-width:300px;scroll-snap-align:start}
.pcar-arrow{position:absolute;top:42%;z-index:4;background:var(--blanco);border:1px solid var(--linea);width:42px;height:42px;border-radius:50%;cursor:pointer;font-size:1.1rem;color:var(--carbon);display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(15,15,15,.1)}
.pcar-arrow.prev{left:4px}.pcar-arrow.next{right:4px}.pcar-arrow:hover{border-color:var(--bronce);color:var(--bronce-deep)}
@media(max-width:620px){.pcar-arrow{display:none}}
.viewall{display:inline-block;margin-top:14px;font-size:.7rem;letter-spacing:.16em;text-transform:uppercase;color:var(--bronce);border-bottom:1px solid var(--bronce);padding-bottom:2px}
.brandstory{background:var(--blanco);border-top:1px solid var(--linea);border-bottom:1px solid var(--linea);text-align:center;padding:82px 28px;margin-top:72px}
.brandstory .eyebrow{font-size:.7rem;letter-spacing:.32em;text-transform:uppercase;color:var(--bronce)}
.brandstory h2{font-family:var(--serif);font-weight:500;font-size:clamp(2.2rem,5vw,3.2rem);margin:14px 0 16px}
.brandstory p{color:var(--gris);max-width:56ch;margin:0 auto;line-height:1.7;font-size:1.02rem}
.brandstory .ctas{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-top:30px}
.tiles{max-width:1180px;margin:0 auto;padding:34px 28px 0;display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.tile{position:relative;aspect-ratio:4/3;border:1px solid var(--linea);background:var(--hueso);overflow:hidden;cursor:pointer;display:flex;align-items:flex-end}
.tile .ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:.62rem;letter-spacing:.2em;text-transform:uppercase;color:var(--bronce);opacity:.65}
.tile .ov{position:relative;width:100%;padding:18px 20px;background:linear-gradient(to top,rgba(15,15,15,.72),rgba(15,15,15,0));color:#fff;display:flex;align-items:flex-end;justify-content:space-between}
.tile .ov h3{font-family:var(--serif);font-weight:600;font-size:1.45rem}
.tile .ov span{font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;color:#fff;border-bottom:1px solid var(--bronce);padding-bottom:2px}
.tile:hover{border-color:var(--bronce)}
@media(max-width:680px){.tiles{grid-template-columns:1fr 1fr}}@media(max-width:440px){.tiles{grid-template-columns:1fr}}
.promo{max-width:1180px;margin:72px auto 0;padding:0 28px}
.promo .in{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--linea);background:var(--hueso)}
.promo .pimg{position:relative;min-height:300px;display:flex;align-items:center;justify-content:center;border-right:1px solid var(--linea);font-size:.62rem;letter-spacing:.2em;text-transform:uppercase;color:var(--bronce);opacity:.8}
.promo .ptxt{padding:48px 44px;display:flex;flex-direction:column;justify-content:center;align-items:flex-start}
.promo .eyebrow{font-size:.7rem;letter-spacing:.3em;text-transform:uppercase;color:var(--bronce)}
.promo h2{font-family:var(--serif);font-weight:500;font-size:clamp(1.8rem,3.5vw,2.4rem);margin:12px 0 14px}
.promo p{color:var(--gris);line-height:1.65;margin-bottom:24px}
@media(max-width:720px){.promo .in{grid-template-columns:1fr}.promo .pimg{border-right:0;border-bottom:1px solid var(--linea);min-height:190px}}
.guides{max-width:1180px;margin:0 auto;padding:34px 28px 0;display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
.guide{border:1px solid var(--linea);background:var(--blanco);display:flex;flex-direction:column}
.guide .gimg{position:relative;height:168px;background:var(--hueso);display:flex;align-items:center;justify-content:center;border-bottom:1px solid var(--linea);font-size:.6rem;letter-spacing:.2em;text-transform:uppercase;color:var(--bronce);opacity:.8}
.guide .gbody{padding:22px 24px 24px;flex:1;display:flex;flex-direction:column;align-items:flex-start}
.guide .glabel{font-size:.62rem;letter-spacing:.2em;text-transform:uppercase;color:var(--bronce)}
.guide h3{font-family:var(--serif);font-weight:600;font-size:1.4rem;margin:6px 0 10px}
.guide p{font-size:.88rem;color:var(--gris);line-height:1.55;margin-bottom:16px;flex:1}
.guide a{font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;color:var(--carbon);border-bottom:1px solid var(--bronce);padding-bottom:2px}
@media(max-width:760px){.guides{grid-template-columns:1fr}}
.trustband{background:var(--carbon-true);color:#F3EDE4;text-align:center;padding:76px 28px;margin-top:72px}
.trustband .eyebrow{font-size:.7rem;letter-spacing:.32em;text-transform:uppercase;color:var(--bronce)}
.trustband h2{font-family:var(--serif);font-weight:500;font-size:clamp(1.9rem,4vw,2.7rem);max-width:26ch;margin:14px auto 0;line-height:1.22}
.trustband .mini{display:flex;gap:46px;justify-content:center;flex-wrap:wrap;margin-top:36px}
.trustband .mini div{font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:#cfc8bd}
.trustband .mini b{display:block;font-family:var(--serif);font-size:1.55rem;color:var(--bronce);letter-spacing:0;text-transform:none;margin-bottom:4px}
/* placeholders de imagen elegantes (mientras no hay fotos) */
.imgph{position:absolute;inset:0;background:var(--hueso);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:11px;overflow:hidden}
.imgph::before{content:"";position:absolute;inset:0;background-image:repeating-linear-gradient(45deg,rgba(168,132,84,.06) 0 1px,transparent 1px 13px)}
.imgph .ph-ico{position:relative;width:60px;height:auto;opacity:.42}
.imgph .ph-ico circle,.imgph .ph-ico path{fill:none;stroke:var(--bronce);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.imgph .ph-t{position:relative;font-size:.58rem;letter-spacing:.2em;text-transform:uppercase;color:var(--bronce);opacity:.78}
.card .img .imgph{transition:transform .4s}.card:hover .img .imgph{transform:scale(1.03)}
.card .was{display:block;font-family:var(--sans);font-weight:300;font-size:.76rem;color:var(--gris);text-decoration:line-through;text-decoration-color:var(--bronce);line-height:1;margin-bottom:3px}
.tile .imgph{transition:transform .5s}.tile:hover .imgph{transform:scale(1.04)}
/* páginas internas (catálogo, consigna, visítanos, guías) */
.phead{text-align:center;padding:66px 28px 10px;background:var(--blanco);border-bottom:1px solid var(--linea)}
.phead .eyebrow{font-size:.7rem;letter-spacing:.32em;text-transform:uppercase;color:var(--bronce)}
.phead h1{font-family:var(--serif);font-weight:500;font-size:clamp(2.3rem,5.5vw,3.5rem);margin:14px 0 12px}
.phead p{color:var(--gris);max-width:54ch;margin:0 auto;line-height:1.6}
.catwrap{max-width:1180px;margin:0 auto;padding:0 28px 10px}
.info2{max-width:1080px;margin:0 auto;padding:54px 28px 0;display:grid;grid-template-columns:1fr 1fr;gap:34px;align-items:start}
.info2 .det h3{font-family:var(--serif);font-weight:600;font-size:1.5rem;margin-bottom:16px}
.info2 .det .irow{display:flex;gap:14px;padding:13px 0;border-bottom:1px solid var(--linea);font-size:.92rem;color:var(--carbon)}
.info2 .det .irow .k{min-width:90px;font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;color:var(--bronce);padding-top:3px}
.info2 .det .irow a{color:var(--carbon);text-decoration:underline;text-underline-offset:2px}
.info2 .det .icta{margin-top:26px;display:flex;gap:12px;flex-wrap:wrap}
.mapwrap{border:1px solid var(--linea);overflow:hidden;min-height:360px;background:var(--hueso)}
.mapwrap iframe{width:100%;height:100%;min-height:360px;border:0;display:block;filter:grayscale(.25)}
.maplink{display:inline-block;margin-top:12px;font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:var(--bronce);border-bottom:1px solid var(--bronce);padding-bottom:2px}
@media(max-width:720px){.info2{grid-template-columns:1fr}.mapwrap{min-height:260px}}
.prose{max-width:740px;margin:0 auto;padding:50px 28px 0}
.prose .back{display:inline-block;margin-bottom:18px;font-size:.7rem;letter-spacing:.16em;text-transform:uppercase;color:var(--gris)}
.prose .lead{font-family:var(--serif);font-style:italic;font-size:clamp(1.2rem,2.6vw,1.5rem);line-height:1.45;color:var(--carbon);margin-bottom:28px}
.prose h2{font-family:var(--serif);font-weight:600;font-size:1.5rem;margin:30px 0 10px}
.prose p{line-height:1.75;color:#3a3833;margin-bottom:14px}
.prose ul{margin:0 0 14px 0;padding-left:20px;color:#3a3833;line-height:1.7}.prose li{margin-bottom:7px}
/* fotos de stock en espacios decorativos (background-image inline) */
.hslide .himg,.tile,.promo .pimg,.guide .gimg{background-size:cover;background-position:center;background-repeat:no-repeat}
.tile.has-img .ph{display:none}
.tile.has-img .ov{background:linear-gradient(to top,rgba(15,15,15,.82),rgba(15,15,15,.05))}
/* ===== ficha de producto (estilo TPC) ===== */
.product{max-width:1180px;margin:26px auto 0;padding:0 28px;display:grid;grid-template-columns:1.12fr .88fr;gap:42px;align-items:start}
@media(max-width:860px){.product{grid-template-columns:1fr;gap:24px}}
.back2{display:inline-block;max-width:1180px;margin:18px auto 0;padding:0 28px;width:100%;font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;color:var(--gris)}
.pgal-main{position:relative;background:var(--hueso);border:1px solid var(--linea);aspect-ratio:4/3;overflow:hidden;display:flex;align-items:center;justify-content:center}
.pgal-main.has-img{cursor:zoom-in}
.pgal-main img{width:100%;height:100%;object-fit:cover}
.pgal-thumbs{display:flex;gap:8px;margin-top:10px;overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none}
.pgal-thumbs::-webkit-scrollbar{display:none}
.pgal-thumb{flex:none;width:76px;height:76px;border:1px solid var(--linea);background:var(--hueso);padding:0;cursor:pointer;overflow:hidden;position:relative}
.pgal-thumb img{width:100%;height:100%;object-fit:cover}
.pgal-thumb.on{border-color:var(--bronce)}
.pgal-thumb.ph{display:flex;align-items:center;justify-content:center;cursor:default}
.pgal-thumb.ph svg{width:36px;height:auto}.pgal-thumb.ph svg circle,.pgal-thumb.ph svg path{stroke:var(--bronce);stroke-width:2.4;fill:none;opacity:.45}
.lightbox{position:fixed;inset:0;z-index:1100;background:rgba(5,5,5,.93);display:none;align-items:center;justify-content:center;padding:30px;cursor:zoom-out}
.lightbox.open{display:flex}
.lightbox img{max-width:100%;max-height:100%;object-fit:contain}
.buybox{position:sticky;top:84px}
@media(max-width:860px){.buybox{position:static}}
.bb-brand{font-size:.66rem;letter-spacing:.2em;text-transform:uppercase;color:var(--bronce);font-weight:600}
.bb-title{font-family:var(--serif);font-weight:500;font-size:clamp(1.9rem,3.6vw,2.7rem);line-height:1.04;margin:8px 0 10px}
.bb-item{font-size:.74rem;color:var(--gris);margin-bottom:16px}
.bb-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:11px 0;border-top:1px solid var(--linea);font-size:.92rem}
.bb-badge{display:inline-flex;align-items:center;gap:7px;font-weight:500}
.bb-badge svg{width:15px;height:17px}.bb-badge svg path{fill:none;stroke:var(--bronce);stroke-width:1.7}
.bb-link{font-size:.76rem;color:var(--gris);text-decoration:underline;text-underline-offset:2px}
.bb-link:hover{color:var(--carbon)}
.bb-price{padding:16px 0 4px;border-top:1px solid var(--linea);margin-top:6px}
.bb-was{font-size:.95rem;color:var(--gris);text-decoration:line-through;text-decoration-color:var(--bronce);margin-right:9px}
.bb-info{cursor:help;color:var(--gris);font-size:.8rem;border:1px solid var(--linea);border-radius:50%;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle}
.bb-now{font-family:var(--serif);font-weight:600;font-size:2.7rem;line-height:1;margin-top:4px}
.bb-benefit{display:flex;gap:11px;align-items:flex-start;background:var(--hueso);border:1px solid var(--linea);border-radius:3px;padding:14px 16px;margin:18px 0;font-size:.85rem;line-height:1.45;color:var(--carbon)}
.bb-benefit svg{width:18px;height:20px;flex:none;margin-top:1px}.bb-benefit svg path{fill:none;stroke:var(--bronce);stroke-width:1.7}
.bb-cta{display:flex;flex-direction:column;gap:10px;margin-top:6px}
.bb-cta>*{width:100%;text-align:center}
.bb-resv{display:flex;gap:10px;align-items:flex-start;margin:14px 0 0;padding:12px 14px;background:var(--hueso);border-left:3px solid var(--bronce);font-size:.82rem;line-height:1.4}
.bb-resv .d{flex:none;width:8px;height:8px;border-radius:50%;background:var(--bronce);margin-top:5px;animation:resvPulse 1.6s ease-in-out infinite}
/* secciones inferiores */
.psecs{max-width:1080px;margin:18px auto 0;padding:0 28px}
.psec{padding:34px 0;border-top:1px solid var(--linea)}
.psec>h2{font-family:var(--serif);font-weight:600;font-size:1.5rem;margin-bottom:16px}
.psec .lead2{font-size:.72rem;letter-spacing:.22em;text-transform:uppercase;color:var(--bronce);margin-bottom:14px}
.inspbar{background:var(--hueso);border:1px solid var(--linea);border-radius:3px;padding:24px 26px;margin-top:8px}
.inspbar h3{font-family:var(--serif);font-weight:600;font-size:1.25rem;margin-bottom:16px}
.inspbar .checks{display:grid;grid-template-columns:1fr 1fr;gap:10px 26px}
.inspbar .checks div{display:flex;gap:10px;align-items:center;font-size:.9rem}
.inspbar .checks div::before{content:"";width:16px;height:16px;flex:none;border:1.5px solid var(--bronce);border-radius:50%;background:radial-gradient(circle at 50% 55%,var(--bronce) 0 2px,transparent 2px)}
@media(max-width:560px){.inspbar .checks{grid-template-columns:1fr}}
.acc{border-top:1px solid var(--linea)}.acc:last-of-type{border-bottom:1px solid var(--linea)}
.acc-h{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:17px 2px;cursor:pointer;font-weight:500;font-size:.95rem}
.acc-h::after{content:"+";color:var(--bronce);font-size:1.3rem;line-height:1}
.acc.open .acc-h::after{content:"\\2013"}
.acc-b{max-height:0;overflow:hidden;transition:max-height .25s ease}
.acc.open .acc-b{max-height:520px}
.acc-b .inner{padding:0 2px 18px;color:var(--gris);font-size:.9rem;line-height:1.6}
.tabs{display:flex;gap:0;border-bottom:1px solid var(--linea);margin-bottom:18px;flex-wrap:wrap}
.tabbtn{background:none;border:0;border-bottom:2px solid transparent;padding:12px 18px;cursor:pointer;font-family:var(--sans);font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:var(--gris);margin-bottom:-1px}
.tabbtn.on{color:var(--carbon);border-bottom-color:var(--bronce)}
.tabpanel{display:none}.tabpanel.on{display:block}
.kvtable .row{display:flex;justify-content:space-between;gap:14px;padding:10px 0;font-size:.9rem;border-bottom:1px solid var(--linea)}
.kvtable .row span:first-child{color:var(--gris)}
.pdfbox{border:1px solid var(--linea);background:var(--hueso);overflow:hidden}
.pdfbox iframe{width:100%;height:580px;border:0;display:block;background:#fff}
.pdf-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:14px}
.support{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--linea);background:var(--hueso);margin-top:18px}
.support .simg{position:relative;min-height:200px;background-size:cover;background-position:center;border-right:1px solid var(--linea)}
.support .stxt{padding:30px 32px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center}
.support h3{font-family:var(--serif);font-weight:600;font-size:1.4rem;margin-bottom:8px}
.support p{font-size:.9rem;color:var(--gris);line-height:1.55;margin-bottom:18px}
.support .sactions{display:flex;gap:12px;flex-wrap:wrap}
@media(max-width:680px){.support{grid-template-columns:1fr}.support .simg{border-right:0;border-bottom:1px solid var(--linea);min-height:150px}}
`;

// URL del sitio para metas absolutas (OpenGraph/canonical/sitemap). Override con SITE_URL en el build.
const SITE = (process.env.SITE_URL || 'https://biketrust-sitio.pages.dev').replace(/\/$/,'');
const SITE_DESC = 'Bicicletas Specialized usadas, premium y certificadas en Santiago. Cada bici inspeccionada multipunto, con diagnóstico honesto y garantía. La confianza de comprar usado, sin el riesgo.';
const escA = s => esc(s).replace(/"/g,'&quot;');                 // escape para atributos (incluye comillas)
const absUrl = p => /^https?:\/\//.test(p) ? p : SITE + (String(p).startsWith('/') ? p : '/'+p);

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
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Jost:wght@300;400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css"></head><body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="sh" viewBox="0 0 32 36"><path d="M4 6 Q4 3 7 3 H25 Q28 3 28 6 V20 Q28 23.5 25.4 25.2 L16 32 L6.6 25.2 Q4 23.5 4 20 Z"/></symbol></svg>`;
};
const TOPBAR = `<header class="nav2"><div class="in">
  <a class="lock" href="/"><svg class="shield"><use href="#sh"/></svg><span><b>BIKE</b> TRUST</span></a>
  <nav class="links">
    <a href="/catalogo.html">Catálogo</a>
    <a href="/como-certificamos.html">Cómo certificamos</a>
    <a href="/consigna.html">Consigna</a>
    <a href="/visitanos.html">Visítanos</a>
    <button type="button" class="navcta js-agendar">Agenda tu visita</button>
  </nav>
</div></header>`;
const FOOT = `<footer class="foot2"><div class="in">
  <div class="fcol"><a class="lock" href="/"><svg class="shield"><use href="#sh"/></svg><span><b>BIKE</b> TRUST</span></a>
    <p class="ftag">Bicicletas Specialized usadas, certificadas. Santiago, Chile.</p></div>
  <div class="fcol"><h4>Explora</h4><a href="/catalogo.html">Catálogo</a><a href="/como-certificamos.html">Cómo certificamos</a><a href="/consigna.html">Consigna tu bici</a><button type="button" class="flink js-agendar">Agenda tu visita</button></div>
  <div class="fcol"><h4>Aprende</h4><a href="/guias/leer-diagnostico.html">Cómo leer el diagnóstico</a><a href="/guias/electrica-o-muscular.html">Eléctrica o muscular</a><a href="/guias/estado-honesto.html">Qué es el estado honesto</a></div>
  <div class="fcol fcontact"><h4>Visítanos</h4><a href="/visitanos.html">Av. Las Condes 12461, Las Condes</a><br>Santiago · Chile<br>+56 9 8523 2895<br>biketrust.cl</div>
</div><div class="legal">© Bike Trust · Specialized usadas certificadas</div></footer></body></html>`;
const FOOT_OPEN = FOOT.replace('</body></html>','');

// Favicon: el escudo de la marca, en bronce.
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 36"><path d="M4 6 Q4 3 7 3 H25 Q28 3 28 6 V20 Q28 23.5 25.4 25.2 L16 32 L6.6 25.2 Q4 23.5 4 20 Z" fill="#A88454"/></svg>`;

// sitemap.xml con todas las URLs limpias (home, páginas, guías, fichas).
function sitemapXML(bikes){
  const today = new Date().toISOString().slice(0,10);
  const urls = ['/', '/catalogo', '/como-certificamos', '/consigna', '/visitanos',
    ...GUIAS.map(g=>`/guias/${g.slug}`), ...bikes.map(b=>`/bici/${b.slug}`)];
  const body = urls.map(u=>`  <url><loc>${SITE}${u}</loc><lastmod>${today}</lastmod></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

// Página 404 on-brand. Cloudflare Pages la sirve automáticamente en rutas no encontradas.
function notFoundHTML(){
  return HEAD('Página no encontrada · Bike Trust', {path:'/404'}) +
`<header class="nav2"><div class="in"><a class="lock" href="/"><svg class="shield"><use href="#sh"/></svg><span><b>BIKE</b> TRUST</span></a></div></header>
<main style="max-width:640px;margin:0 auto;padding:90px 24px 110px;text-align:center">
  <div style="color:var(--bronce);letter-spacing:.18em;text-transform:uppercase;font-size:.72rem;margin-bottom:14px">Error 404</div>
  <h1 style="font-family:var(--serif);font-weight:600;font-size:2.1rem;line-height:1.15;margin-bottom:16px">Esta bici ya no está disponible</h1>
  <p style="color:var(--gris);font-size:1rem;line-height:1.6;margin-bottom:30px">Puede que se haya vendido, o que el enlace haya cambiado. Pero tenemos más Specialized certificadas esperándote.</p>
  <a class="btn-primary" href="/catalogo" style="display:inline-block">Ver el catálogo</a>
  <div style="margin-top:18px"><a href="/" style="color:var(--bronce);font-size:.9rem">Volver al inicio</a></div>
</main>` + FOOT;
}

/* ---------- reserva (modal de agendamiento) ---------- */
const WA_NUM = '56985232895';                  // WhatsApp tienda (fallback de contacto)
// Horarios de visita ofrecidos (10:00–18:30 cada 30 min). Ajustable.
function timeSlots(){
  const out=[];
  for(let h=10;h<=18;h++) for(const m of ['00','30']) out.push(h+':'+m);
  return out;
}
// JS del modal. String.raw evita que build.mjs "coma" los backslashes de los regex.
const RESERVA_JS = String.raw`(function(){
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
    show(stepn,num); show(bBack,n===2); show(bNext,n===1); show(bSubmit,n===2); show(bDone,n==='ok');
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
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err('.rsv-err2','Escribe un correo válido.');
    if(tel.replace(/\D/g,'').length<8) return err('.rsv-err2','Escribe un teléfono válido.');
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
      q('.rsv-ok h3').textContent='¡Reserva enviada!';
      q('.rsv-okmsg').textContent='Te contactaremos para confirmar tu visita el '+p.fecha+' a las '+p.hora+'. ¡Te esperamos!';
    }
    setStep('ok');
  }
  [].forEach.call(document.querySelectorAll('.js-agendar'),function(b){
    b.addEventListener('click',function(e){ e.preventDefault(); openModal(b.getAttribute('data-slug')); });
  });
  ov.querySelector('.rsv-x').addEventListener('click',closeModal);
  ov.querySelector('.rsv-ov-bg').addEventListener('click',closeModal);
  document.addEventListener('keydown',function(e){ if(e.key==='Escape' && ov.classList.contains('open')) closeModal(); });
  var WA_NUM='` + WA_NUM + `';
})();`;
function reservaModal(bikes){
  const slots = timeSlots().map(t=>`<option value="${t}">${t}</option>`).join('');
  const models = bikes.map(b=>{
    const meta=[b.disciplina, b.talla&&'Talla '+b.talla].filter(Boolean).join(' · ');
    const label=esc(b.modelo + (b.talla?' · Talla '+b.talla:''));
    return `<label class="rsv-model"><input type="checkbox" class="rsv-cb" value="${esc(b.slug)}" data-label="${label}" data-recid="${esc(b.recId)}"><span class="rsv-check"></span><span class="rsv-mtxt"><span class="rsv-mname">${esc(b.modelo)}</span><span class="rsv-mmeta">${esc(meta)}</span></span></label>`;
  }).join('');
  return `<div class="rsv-ov" id="rsv" aria-hidden="true"><div class="rsv-ov-bg"></div>
  <div class="rsv" role="dialog" aria-modal="true" aria-label="Agenda tu visita">
    <div class="rsv-hd"><div class="rsv-ttl"><svg class="shield"><use href="#sh"/></svg>Agenda tu visita</div><button type="button" class="rsv-x" aria-label="Cerrar">×</button></div>
    <div class="rsv-stepn">Paso 1 de 2</div>
    <form class="rsv-form" novalidate>
      <div class="rsv-bd">
        <div class="rsv-step on" data-step="1">
          <p class="rsv-intro">Elige el día y la hora que prefieres para visitarnos en tienda. Te contactamos para confirmar.</p>
          <div class="rsv-field"><label class="rsv-lbl">Fecha</label><input type="date" class="rsv-date" required></div>
          <div class="rsv-field"><label class="rsv-lbl">Hora</label><select class="rsv-time" required><option value="">Elige una hora</option>${slots}</select></div>
          <div class="rsv-err rsv-err1 hidden"></div>
        </div>
        <div class="rsv-step" data-step="2">
          <label class="rsv-lbl">¿Qué modelo(s) quieres ver? <span class="rsv-count">0/3</span></label>
          <p class="rsv-note">Si te interesa ver más modelos, avísanos para tenértelos preparados.</p>
          <div class="rsv-models">${models}</div>
          <div class="rsv-grid2">
            <div class="rsv-field"><label class="rsv-lbl">Nombre</label><input type="text" class="rsv-name" autocomplete="name" required></div>
            <div class="rsv-field"><label class="rsv-lbl">Teléfono</label><input type="tel" class="rsv-phone" autocomplete="tel" required></div>
          </div>
          <div class="rsv-field"><label class="rsv-lbl">Correo</label><input type="email" class="rsv-email" autocomplete="email" required></div>
          <div class="rsv-err rsv-err2 hidden"></div>
        </div>
        <div class="rsv-step rsv-ok" data-step="ok"><svg class="shield" style="width:34px;height:39px;margin:0 auto 8px;display:block"><use href="#sh"/></svg><h3>¡Reserva enviada!</h3><p class="rsv-okmsg"></p></div>
      </div>
      <div class="rsv-ft">
        <button type="button" class="rsv-btn ghost rsv-back hidden">Atrás</button>
        <button type="button" class="rsv-btn rsv-next">Continuar</button>
        <button type="submit" class="rsv-btn rsv-submit hidden">Confirmar reserva</button>
        <button type="button" class="rsv-btn rsv-done hidden">Listo</button>
      </div>
    </form>
  </div></div>
<script>${RESERVA_JS}</script>`;
}

/* ---------- ficha ---------- */
// JS de la ficha de producto: galería (thumbs + lightbox), acordeones, tabs
const FICHA_JS = String.raw`(function(){
  var main=document.querySelector('.pgal-main img'), thumbs=document.querySelectorAll('.pgal-thumb');
  [].forEach.call(thumbs,function(t){ t.addEventListener('click',function(){
    var src=t.getAttribute('data-src'); if(!src||!main) return;
    main.src=src; [].forEach.call(thumbs,function(x){x.classList.remove('on');}); t.classList.add('on');
  });});
  var lb=document.querySelector('.lightbox'), box=document.querySelector('.pgal-main.has-img');
  if(lb&&box&&main){
    box.addEventListener('click',function(){ lb.querySelector('img').src=main.src; lb.classList.add('open'); document.body.style.overflow='hidden'; });
    lb.addEventListener('click',function(){ lb.classList.remove('open'); document.body.style.overflow=''; });
  }
  [].forEach.call(document.querySelectorAll('.acc-h'),function(h){ h.addEventListener('click',function(){ h.parentElement.classList.toggle('open'); }); });
  [].forEach.call(document.querySelectorAll('.tabbtn'),function(b){ b.addEventListener('click',function(){
    var panel=document.getElementById(b.getAttribute('data-tab'));
    [].forEach.call(b.parentElement.querySelectorAll('.tabbtn'),function(x){x.classList.remove('on');}); b.classList.add('on');
    [].forEach.call(document.querySelectorAll('.tabpanel'),function(p){p.classList.remove('on');});
    if(panel) panel.classList.add('on');
  });});
})();`;

// ---------- Ficha técnica imprimible (auto-generada, A4, print-to-PDF) ----------
const FICHA_CSS = `
:root{--bronce:#A88454;--tinta:#1a1a1a;--gris:#6b6b6b;--linea:#e6e1d8;--hueso:#faf8f4}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Jost',sans-serif;color:var(--tinta);background:#d9d6d0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:13px 22px;background:#fff;border-bottom:1px solid var(--linea);box-shadow:0 1px 8px rgba(0,0,0,.06)}
.toolbar a{color:var(--gris);text-decoration:none;font-size:.85rem}
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
    ? `<div class="score">${esc(b.puntaje)}</div><div class="clbl">Puntaje de certificación</div>`
    : `<div class="score">✓</div><div class="clbl">Certificada por Bike Trust</div>`;
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
<div class="toolbar"><a href="/bici/${esc(b.slug)}.html">← Volver a la ficha</a><button onclick="window.print()">Descargar PDF</button></div>
<article class="sheet">
  <div class="brandbar"><div class="lock"><svg class="shield"><use href="#sh"/></svg><span class="bn"><b>BIKE</b> TRUST</span></div><div class="doc">Ficha técnica · Certificado</div></div>
  <h1>${esc(b.marca)} ${esc(b.modelo)}</h1>
  <div class="sub">${esc(b.disciplina||'')} · ${esc(motor)}${b.talla?' · Talla '+esc(b.talla):''}${b.anio?' · '+esc(b.anio):''}</div>
  ${intro}
  ${hero}
  <div class="row2"><table class="kv">${kv}</table><div class="cert">${cert}</div></div>
  ${diag}${honest}${specs}${geo}
  <div class="foot"><span>Certificada por Bike Trust · Santiago, Chile</span><span>Emitida ${esc(today)} · biketrust.cl</span></div>
</article></body></html>`;
}

function fichaHTML(b, bikes){
  const fotos = b.fotos;
  const galMain = fotos.length
    ? `<div class="pgal-main has-img"><img src="${esc(fotos[0])}" alt="${esc(b.marca+' '+b.modelo)}">${b.fotoReferencial?`<div class="ref-note">Imagen referencial del modelo · la unidad real puede variar</div>`:''}</div>`
    : `<div class="pgal-main">${imgPH('Foto pendiente')}</div>`;
  const galThumbs = fotos.length
    ? fotos.map((f,i)=>`<button type="button" class="pgal-thumb${i===0?' on':''}" data-src="${esc(f)}"><img src="${esc(f)}" alt=""></button>`).join('')
    : [0,1,2,3].map(()=>`<button type="button" class="pgal-thumb ph">${BIKEICON}</button>`).join('');
  const lightbox = fotos.length ? `<div class="lightbox"><img src="" alt=""></div>` : '';

  const wasHtml = b.precioNuevo&&b.precioNuevo>b.precio
    ? `<span class="bb-was">${clp(b.precioNuevo)}</span><span class="bb-info" title="Valor de referencia de la bici nueva">i</span>` : '';
  const nowHtml = b.precio!=null ? clp(b.precio) : 'Consultar';
  const subline = [b.anio, b.talla&&'Talla '+b.talla, b.disciplina, b.referencia&&'Ref '+b.referencia].filter(Boolean).join(' · ');
  const fitRow = b.rangoAltura
    ? `<div class="bb-row"><b>Calza:</b> ${esc(b.rangoAltura)}<a class="bb-link" href="/visitanos.html">Te asesoramos en tu visita</a></div>` : '';
  const reservaBB = b.reservada
    ? `<div class="bb-resv"><span class="d"></span><div><b>Alguien agendó una visita para verla.</b> Sigue disponible — agéndala tú también.</div></div>` : '';
  const waMsg = encodeURIComponent(`Hola! Me interesa la ${b.marca} ${b.modelo}${b.talla?' (talla '+b.talla+')':''}. ¿Sigue disponible?`);

  const diag = b.electrica ? `<div class="diag"><div class="head"><svg class="shield"><use href="#sh"/></svg><span>Diagnóstico digital · escaneo en tienda</span></div>
    <div class="g">
      <div><div class="n">${b.diagKm!=null?Number(b.diagKm).toLocaleString('es-CL'):'—'}</div><div class="u">km</div><div class="l">Motor</div></div>
      <div><div class="n">${b.diagBat!=null?b.diagBat+'<span style="font-size:1.4rem">%</span>':'—'}</div><div class="u">salud</div><div class="l">Batería</div></div>
      <div><div class="n">${b.diagCic!=null?b.diagCic:'—'}</div><div class="u">ciclos</div><div class="l">Carga</div></div>
    </div><div class="foot">Datos reales medidos sobre esta bici. Nada estimado.</div></div>` : '';
  const estadoLis = (b.estado.length?b.estado:['[ Rayón / marca real — ubicación ]','[ Estado de transmisión, pastillas, neumáticos ]','[ Cualquier detalle cosmético o funcional ]'])
    .map(t=>`<li>${esc(t)}</li>`).join('');
  const estadoNote = b.estado.length ? '' : `<p class="note">Pendiente: el taller completa con los defectos reales de esta unidad.</p>`;
  const specs = b.specs.map(g=>`<div class="blk"><h3>${esc(g.grupo)}</h3>${g.filas.map(f=>`<div class="row"><span>${esc(f[0])}</span><span>${esc(f[1])}</span></div>`).join('')}</div>`).join('');
  const whyP = b.porQue ? esc(b.porQue) : `<span style="color:var(--gris)">[ Una frase que enamore — por completar ]</span>`;
  const specsBlock = b.specs.length ? `<div class="specs">${specs}</div>`
    : `<p style="font-size:.86rem;color:var(--gris);font-style:italic">Pendiente: completar el campo «Specs clave» en Airtable.</p>`;
  const det = [
    ['Valor nueva', b.precioNuevo?clp(b.precioNuevo):'por confirmar'],
    ['Año', b.anio||'—'], ['Marca', b.marca], ['Modelo', b.modelo],
    ['Talla', b.talla||'—'], ['Disciplina', b.disciplina||'—'],
    ['Motorización', b.electrica?'Eléctrica':'Muscular'],
    ['Material del cuadro', b.material||'por confirmar'],
    ['Puntaje certificación', b.puntaje!=null?b.puntaje+'/100':'por confirmar'],
    b.referencia?['Referencia', b.referencia]:null
  ].filter(Boolean);
  const detailsRows = det.map(r=>`<div class="row"><span>${esc(r[0])}</span><span>${esc(r[1])}</span></div>`).join('');
  const pdfSection = `<div class="pdfbox" style="display:flex;align-items:center;justify-content:space-between;gap:22px;flex-wrap:wrap;padding:26px 30px">
       <div style="flex:1;min-width:240px"><div style="color:var(--bronce);font-size:.66rem;letter-spacing:.2em;text-transform:uppercase;margin-bottom:8px">Ficha técnica certificada</div>
         <div style="color:var(--gris);font-size:.92rem;line-height:1.55">El documento completo de esta unidad —especificaciones, diagnóstico y estado honesto— generado por Bike Trust y listo para descargar en PDF.</div></div>
       <a class="btn-primary" href="/ficha/${esc(b.slug)}.html" target="_blank" rel="noopener">Ver ficha técnica (PDF)</a>
     </div>`;
  const certblk = `<div class="certblk"><div class="head"><svg class="shield" style="width:26px;height:30px"><use href="#sh"/></svg><h2>Certificada por Bike Trust</h2></div>
    <div class="sub">Inspeccionada · Probada · Confiable</div>
    <div class="checks"><div>Integridad del cuadro verificada</div><div>Componentes inspeccionados</div><div>Transmisión limpiada y afinada</div><div>Suspensión revisada</div><div>Ruedas centradas</div>${b.electrica?'<div>Diagnóstico digital de motor y batería</div>':''}</div>
    <p class="promise">Nos especializamos en Specialized usadas. Cada bici pasa por el taller de mecánicos expertos y se entrega con respaldo. <span style="color:var(--bronce)">[ Términos de garantía — por confirmar ]</span></p></div>`;

  return HEAD(`${b.marca} ${b.modelo}${b.talla?' · Talla '+b.talla:''} · Bike Trust`, {
    path:`/bici/${b.slug}`, type:'product', image:b.fotos[0],
    desc:`${b.marca} ${b.modelo}${b.talla?' talla '+b.talla:''} usada y certificada por Bike Trust${b.precio?' · '+clp(b.precio):''}. ${b.electrica?'E-bike con diagnóstico de batería, motor y ciclos. ':''}Inspección multipunto y estado honesto declarado.`
  }) + TOPBAR + `
  <a class="back2" href="/catalogo.html">← Volver al catálogo</a>
  <div class="product">
    <div class="pgal">${galMain}<div class="pgal-thumbs">${galThumbs}</div></div>
    <div class="buybox">
      <div class="bb-brand">${esc(b.marca)}</div>
      <h1 class="bb-title">${esc(b.modelo)}</h1>
      ${subline?`<div class="bb-item">${esc(subline)}</div>`:''}
      <div class="bb-row"><span class="bb-badge"><svg class="shield" style="width:15px;height:17px"><use href="#sh"/></svg>Certificada por Bike Trust</span><a class="bb-link" href="/como-certificamos.html">¿Qué significa?</a></div>
      ${fitRow}
      <div class="bb-price">${wasHtml}<div class="bb-now">${nowHtml}</div></div>
      <div class="bb-benefit"><svg class="shield" style="width:18px;height:20px"><use href="#sh"/></svg><div>Incluye la <b>certificación Bike Trust</b> y el respaldo del taller. Agéndala y pruébala antes de decidir.</div></div>
      ${reservaBB}
      <div class="bb-cta">
        <button type="button" class="btn-primary js-agendar" data-slug="${esc(b.slug)}">Agenda tu visita</button>
        <a class="btn-ghost" href="https://wa.me/56985232895?text=${waMsg}" target="_blank" rel="noopener">Consultar por WhatsApp</a>
      </div>
    </div>
  </div>
  <div class="psecs">
    <div class="psec" style="border-top:0">
      <div class="inspbar"><h3>Cada bici pasa una inspección multipunto</h3>
        <div class="checks"><div>Integridad del cuadro verificada</div><div>Componentes inspeccionados</div><div>Transmisión limpiada y afinada</div><div>Suspensión revisada</div><div>Ruedas centradas</div>${b.electrica?'<div>Diagnóstico digital de motor y batería</div>':''}</div>
      </div>
    </div>
    <div class="psec">
      <div class="acc"><div class="acc-h">Cómo es la compra y la entrega</div><div class="acc-b"><div class="inner">Agendas tu visita, ves y pruebas la bici en nuestra tienda de Las Condes, y si te convence la pagas y te la llevas lista para rodar. Sin envíos ni intermediarios.</div></div></div>
      <div class="acc"><div class="acc-h">Garantía y respaldo</div><div class="acc-b"><div class="inner">Cada bici se entrega afinada y con el respaldo de Bike Trust. <span style="color:var(--bronce)">[ Términos de garantía — por confirmar ]</span></div></div></div>
    </div>
    <div class="psec"><div class="lead2">Por qué amarla</div><p style="font-family:var(--serif);font-style:italic;font-size:clamp(1.3rem,2.6vw,1.6rem);line-height:1.4">${whyP}</p></div>
    ${diag?`<div class="psec">${diag}</div>`:''}
    <div class="psec"><h2>Notas del mecánico · estado honesto</h2><div class="honest"><ul>${estadoLis}</ul>${estadoNote}</div></div>
    <div class="psec"><h2>Especificaciones</h2>
      <div class="tabs"><button type="button" class="tabbtn on" data-tab="tab-det">Detalles</button><button type="button" class="tabbtn" data-tab="tab-build">Componentes</button><button type="button" class="tabbtn" data-tab="tab-geo">Geometría</button></div>
      <div id="tab-det" class="tabpanel on"><div class="kvtable">${detailsRows}</div></div>
      <div id="tab-build" class="tabpanel">${specsBlock}</div>
      <div id="tab-geo" class="tabpanel">${b.geometria.length?`<div class="specs">${b.geometria.map(g=>`<div class="blk"><h3>${esc(g.grupo)}</h3>${g.filas.map(f=>`<div class="row"><span>${esc(f[0])}</span><span>${esc(f[1])}</span></div>`).join('')}</div>`).join('')}</div>`:`<p style="color:var(--gris);font-style:italic;font-size:.9rem">Tabla de geometría — <span style="color:var(--bronce)">por completar (campo «Geometría» en Airtable)</span>.</p>`}</div>
    </div>
    <div class="psec"><h2>Ficha técnica completa</h2>${pdfSection}</div>
    <div class="psec">${certblk}</div>
    <div class="psec"><div class="support"><div class="simg" style="background-image:url('/assets/img/workshop.jpg')"></div><div class="stxt"><h3>¿Dudas sobre esta bici?</h3><p>Escríbenos y te contamos todo lo que necesites saber, o agenda una visita para verla en persona.</p><div class="sactions"><button type="button" class="btn-primary js-agendar" data-slug="${esc(b.slug)}">Agenda tu visita</button><a class="btn-ghost" href="https://wa.me/56985232895?text=${waMsg}" target="_blank" rel="noopener">WhatsApp</a></div></div></div></div>
  </div>
  ${lightbox}
${FOOT_OPEN}${reservaModal(bikes)}<script>${FICHA_JS}</script></body></html>`;
}

/* ---------- catálogo ---------- */
function cardHTML(b){
  const url=`/bici/${b.slug}.html`;
  const img = b.fotos[0] ? `<img src="${esc(b.fotos[0])}" alt="${esc(b.modelo)}">` : imgPH('Foto pendiente');
  const tag = b.reservada ? `<div class="resv-tag">Reservada</div>` : '';
  const ref = (b.fotoReferencial && b.fotos[0]) ? `<div class="ref-tag" title="Foto del modelo, no de la unidad real">Imagen referencial</div>` : '';
  const precio = b.precio!=null
    ? `${b.precioNuevo&&b.precioNuevo>b.precio?`<span class="was">${clp(b.precioNuevo)}</span>`:''}${clp(b.precio)}`
    : 'Consultar';
  return `<a class="card" href="${url}" data-disc="${esc(b.disciplina)}"><div class="img">${tag}${ref}${img}</div><div class="body">
    <div class="disc">${esc(b.disciplina)}${b.talla?' · Talla '+esc(b.talla):''}</div>
    <h3>${esc(b.modelo)}</h3>
    <div class="meta">${esc(b.marca)}${b.anio?' · '+esc(b.anio):''}</div>
    <div class="foot"><div class="price">${precio}</div>
      <div class="badge"><svg class="shield" style="width:14px;height:16px"><use href="#sh"/></svg>Certificada</div></div>
  </div></a>`;
}
// JS del home: hero carrusel + carruseles de producto + tiles + filtro
const HOME_JS = String.raw`(function(){
  var hc=document.querySelector('.hcar');
  if(hc){
    var track=hc.querySelector('.hcar-track'), slides=hc.querySelectorAll('.hslide'), dots=hc.querySelectorAll('.hdot');
    var i=0, n=slides.length, timer;
    function go(k){ i=(k+n)%n; track.style.transform='translateX(-'+(i*100)+'%)'; [].forEach.call(dots,function(d,j){ d.classList.toggle('on',j===i); }); }
    function play(){ stop(); if(n>1) timer=setInterval(function(){ go(i+1); },6500); }
    function stop(){ if(timer) clearInterval(timer); }
    var nx=hc.querySelector('.hnext'), pv=hc.querySelector('.hprev');
    if(nx) nx.addEventListener('click',function(){ go(i+1); play(); });
    if(pv) pv.addEventListener('click',function(){ go(i-1); play(); });
    [].forEach.call(dots,function(d,j){ d.addEventListener('click',function(){ go(j); play(); }); });
    play();
  }
  [].forEach.call(document.querySelectorAll('.pcar'),function(pc){
    var tr=pc.querySelector('.pcar-track'); if(!tr) return;
    function amt(){ return Math.max(280, Math.round(tr.clientWidth*0.85)); }
    var pv=pc.querySelector('.pcar-arrow.prev'), nx=pc.querySelector('.pcar-arrow.next');
    if(pv) pv.addEventListener('click',function(){ tr.scrollBy({left:-amt(),behavior:'smooth'}); });
    if(nx) nx.addEventListener('click',function(){ tr.scrollBy({left:amt(),behavior:'smooth'}); });
  });
  var chips=document.querySelectorAll('.chip'), cards=document.querySelectorAll('#catalogo .card');
  function filtrar(f){
    [].forEach.call(chips,function(x){ x.classList.toggle('on', x.getAttribute('data-f')===f); });
    [].forEach.call(cards,function(card){ card.style.display=(f==='*'||card.getAttribute('data-disc')===f)?'':'none'; });
  }
  [].forEach.call(chips,function(c){ c.addEventListener('click',function(){ filtrar(c.getAttribute('data-f')); }); });
})();`;

// Guías (contenido educativo). Alimenta las cards del home y las páginas /guias/*.
const GUIAS = [
  { slug:'leer-diagnostico', titulo:'Cómo leer el diagnóstico de una e-bike usada', img:'workshop.jpg',
    resumen:'Qué significan los kilómetros del motor, la salud de la batería y los ciclos en una e-bike usada.',
    lead:'En una bici eléctrica usada, los números importan más que las palabras. Esto es lo que medimos en cada unidad y cómo interpretarlo.',
    cuerpo:[
      ['Kilómetros del motor','Es el equivalente al odómetro de la e-bike: cuántos kilómetros ha entregado asistencia el motor. Un sistema Specialized está pensado para decenas de miles de kilómetros, así que cifras de pocos miles son señal de una bici con mucha vida por delante.'],
      ['Salud de la batería','Se mide como un porcentaje sobre la capacidad original (100% = batería nueva). Las baterías pierden capacidad con el uso y el tiempo; sobre 80% es excelente para una usada. Te mostramos el dato tal cual lo arroja el escaneo, sin redondear hacia arriba.'],
      ['Ciclos de carga','Un ciclo equivale a una carga completa, de 0 a 100%. Las baterías modernas conservan buena salud durante varios cientos de ciclos, así que pocos ciclos significan una batería joven.'],
      ['Por qué lo medimos','A simple vista, una e-bike usada se ve igual de bien con 500 o con 15.000 km. El diagnóstico digital es la única forma honesta de conocer su estado real, y por eso lo publicamos en cada ficha.']
    ]},
  { slug:'electrica-o-muscular', titulo:'Eléctrica o muscular: cómo elegir', img:'disc-mtb.jpg',
    resumen:'Cómo decidir entre una e-bike y una bici tradicional según tu uso, tu ruta y tu presupuesto.',
    lead:'¿Te conviene una eléctrica o una muscular? Depende de tu ruta, tu cuerpo y lo que buscas. Te ayudamos a decidir.',
    cuerpo:[
      ['Para qué es cada una','La eléctrica te da asistencia del motor: subes más fácil, llegas más lejos y sin terminar agotado. La muscular es más liviana, más simple y más económica, y premia el pedaleo.'],
      ['Tu ruta y tu uso','Si subes mucho, recorres distancias largas o quieres llegar sin transpirar, la e-bike gana. Si buscas entrenamiento, ligereza y simpleza mecánica, la muscular es tu bici.'],
      ['Presupuesto y mantención','Las eléctricas cuestan más y suman el motor y la batería a la mantención. Las musculares son más baratas de comprar y de mantener en el tiempo.'],
      ['Nuestra recomendación','No hay respuesta única. Cuéntanos tu uso al agendar tu visita y te mostramos, en persona, las opciones que de verdad calzan contigo.']
    ]},
  { slug:'estado-honesto', titulo:'Qué es el «estado honesto»', img:'disc-ruta.jpg',
    resumen:'Por qué declaramos cada rayón y detalle real de la bici antes de que compres.',
    lead:'El «estado honesto» es nuestra forma de declarar los defectos reales de cada bici, de frente, antes de que la compres.',
    cuerpo:[
      ['Qué declaramos','Cada rayón, marca, desgaste de transmisión o detalle cosmético real de esa unidad específica. No de «el modelo» en general, sino de la bici exacta que te llevas.'],
      ['Por qué lo hacemos','Comprar usado a ciegas es la mayor fuente de desconfianza. Si lo sabes antes, no hay sorpresas después: esa es la base de comprar tranquilo.'],
      ['Cómo lo verás','En cada ficha encontrarás una sección «Estado honesto» con las notas del mecánico. Lo bueno y lo no tan bueno, sin letra chica.']
    ]}
];

// filtro de la página de catálogo (chips + parámetro ?d=)
const CATALOG_JS = String.raw`(function(){
  var chips=document.querySelectorAll('.chip'), cards=document.querySelectorAll('#catalogo .card');
  function filtrar(f){ [].forEach.call(chips,function(x){ x.classList.toggle('on', x.getAttribute('data-f')===f); });
    [].forEach.call(cards,function(c){ c.style.display=(f==='*'||c.getAttribute('data-disc')===f)?'':'none'; }); }
  [].forEach.call(chips,function(c){ c.addEventListener('click',function(){ filtrar(c.getAttribute('data-f')); }); });
  try{ var d=new URLSearchParams(location.search).get('d'); if(d) filtrar(d); }catch(e){}
})();`;

function catalogHTML(bikes){
  const discs = [...new Set(bikes.map(b=>b.disciplina).filter(Boolean))];
  const chips = bikes.length>3 && discs.length>1
    ? `<div class="filters"><button class="chip on" data-f="*">Todas</button>${discs.map(d=>`<button class="chip" data-f="${esc(d)}">${esc(d)}</button>`).join('')}</div>` : '';
  const carousel = cards => `<div class="pcar"><button type="button" class="pcar-arrow prev" aria-label="Anterior">‹</button><div class="pcar-track">${cards}</div><button type="button" class="pcar-arrow next" aria-label="Siguiente">›</button></div>`;
  const catalogo = bikes.length
    ? carousel(bikes.map(cardHTML).join(''))
    : `<div class="empty">Pronto, bicis certificadas disponibles.</div>`;
  const ebikes = bikes.filter(b=>b.electrica);
  const SHIELD = `<svg viewBox="0 0 32 36" aria-hidden="true"><path d="M4 6 Q4 3 7 3 H25 Q28 3 28 6 V20 Q28 23.5 25.4 25.2 L16 32 L6.6 25.2 Q4 23.5 4 20 Z"/></svg>`;
  const slide = (eb,h2,p,cta,img)=>`<div class="hslide"><div class="htext"><div class="eyebrow">${esc(eb)}</div><h2>${esc(h2)}</h2><p>${esc(p)}</p>${cta}</div><div class="himg" style="background-image:url('/assets/img/${img}')"></div></div>`;
  const hero = `<section class="hcar"><div class="hcar-track">
    ${slide('Specialized usadas · certificadas','Confianza sobre dos ruedas','Bicicletas Specialized de segunda mano, inspeccionadas por mecánicos expertos. Compra usado con la tranquilidad de lo nuevo.',`<a class="btn-primary" style="background:var(--bronce-deep)" href="/catalogo.html">Ver catálogo</a>`,'hero-trail.jpg')}
    ${slide('Nuestro estándar','Cada bici, certificada','Inspección mecánica, diagnóstico digital real y estado honesto declarado de frente.',`<a class="btn-ghost light" href="/como-certificamos.html">Cómo certificamos</a>`,'workshop.jpg')}
    ${slide('Visítanos en Santiago','Ven a verla en persona','Agenda una visita y te dejamos la bici preparada para que la veas y la pruebes.',`<button type="button" class="btn-primary js-agendar" style="background:var(--bronce-deep)">Agenda tu visita</button>`,'hero-city.jpg')}
  </div><button type="button" class="hprev" aria-label="Anterior">‹</button><button type="button" class="hnext" aria-label="Siguiente">›</button>
  <div class="hdots">${[0,1,2].map((_,i)=>`<button type="button" class="hdot${i===0?' on':''}" aria-label="Slide ${i+1}"></button>`).join('')}</div></section>`;
  const tiles = discs.length ? `<section style="padding-top:0">
    <div class="sec-head"><div class="eyebrow">Explora</div><h2>Por disciplina</h2></div>
    <div class="tiles">${discs.slice(0,3).map(d=>`<a class="tile has-img" style="background-image:url('/assets/img/${discImg(d)}')" href="/catalogo.html?d=${encodeURIComponent(d)}"><div class="ov"><h3>${esc(d)}</h3><span>Ver</span></div></a>`).join('')}</div>
  </section>` : '';
  const ebikesSec = ebikes.length>=2 ? `<section>
    <div class="sec-head"><div class="eyebrow">Con motor</div><h2>E-bikes certificadas</h2><p>Con diagnóstico digital de motor y batería: datos reales de cada unidad.</p></div>
    ${carousel(ebikes.map(cardHTML).join(''))}
  </section>` : '';
  const guides = GUIAS.map(g=>`<div class="guide"><div class="gimg" style="background-image:url('/assets/img/${g.img}')"></div><div class="gbody"><div class="glabel">Guía</div><h3>${esc(g.titulo)}</h3><p>${esc(g.resumen)}</p><a href="/guias/${esc(g.slug)}.html">Leer más</a></div></div>`).join('');
  return HEAD('Bike Trust · Specialized usadas certificadas', {path:'/'}) +
  `<div class="annbar"><b>Specialized usadas certificadas</b> · Visítanos en Las Condes, Santiago <button type="button" class="ab-link js-agendar">Agenda tu visita</button></div>` +
  TOPBAR + hero + `
  <section id="catalogo">
    <div class="sec-head"><div class="eyebrow">El catálogo</div><h2>Nuestras bicis</h2><p>Cada una, certificada por Bike Trust y lista para rodar.</p><a class="viewall" href="/catalogo.html">Ver todas las bicis</a></div>
    ${chips}
    ${catalogo}
  </section>
  <section class="brandstory">
    <div class="eyebrow">Bike Trust</div>
    <h2>La forma confiable de comprar usado</h2>
    <p>Nos especializamos en bicicletas Specialized de segunda mano. Cada una pasa por nuestro taller, se mide con datos reales y se entrega con su estado honesto declarado. Así compras usado sin apostar.</p>
    <div class="ctas"><a class="btn-primary" href="/como-certificamos.html">Cómo certificamos</a><a class="btn-ghost" href="/catalogo.html">Ver catálogo</a></div>
  </section>
  ${tiles}
  <div class="promo"><div class="in">
    <div class="pimg" style="background-image:url('/assets/img/workshop.jpg')"></div>
    <div class="ptxt"><div class="eyebrow">Vende con nosotros</div><h2>¿Tienes una Specialized para vender?</h2><p>Déjala en consignación en Bike Trust. La certificamos, la publicamos y la vendemos por ti, con la confianza que nuestra marca le da a cada bici.</p><a class="btn-primary" href="https://wa.me/56985232895?text=Hola!%20Quiero%20consignar%20mi%20Specialized." target="_blank" rel="noopener">Conversemos</a></div>
  </div></div>
  ${ebikesSec}
  <section>
    <div class="sec-head"><div class="eyebrow">Aprende</div><h2>Antes de comprar</h2><p>Lo que conviene saber para elegir tu próxima Specialized usada.</p></div>
    <div class="guides">${guides}</div>
  </section>
  <section class="trustband">
    <div class="eyebrow">Especialistas en Specialized</div>
    <h2>Cada bici, inspeccionada, medida y entregada con respaldo.</h2>
    <div class="mini"><div><b>100%</b>Specialized</div><div><b>Certificada</b>por nuestro taller</div><div><b>Diagnóstico</b>digital real</div><div><b>Estado</b>honesto</div></div>
  </section>
  <section class="section">
    <div class="sec-head"><div class="eyebrow">Nuestro estándar</div><h2>Cómo certificamos</h2><p>El proceso por el que pasa cada bici antes de llegar a ti.</p></div>
    <div class="steps">
      <div class="stepc"><div class="num">01</div><h3>Inspección</h3><p>Mecánicos expertos revisan cuadro, transmisión, frenos, suspensión y ruedas, punto por punto.</p></div>
      <div class="stepc"><div class="num">02</div><h3>Diagnóstico</h3><p>En e-bikes, escaneo digital de motor y batería: km, salud y ciclos reales, no estimaciones.</p></div>
      <div class="stepc"><div class="num">03</div><h3>Entrega con respaldo</h3><p>Afinada, con su estado honesto declarado y el respaldo de Bike Trust.</p></div>
    </div>
    <div class="steps-cta"><a class="btn-ghost" href="/como-certificamos.html">Ver el proceso completo</a></div>
  </section>
  <section class="ctaband">
    <div class="eyebrow">Visítanos en Santiago</div>
    <h2>Ven a verla en persona</h2>
    <p>Agenda una visita y te dejamos la bici preparada para que la veas y la pruebes.</p>
    <button type="button" class="btn-primary js-agendar">Agenda tu visita</button>
  </section>` + FOOT_OPEN + reservaModal(bikes) + `<script>${HOME_JS}</script></body></html>`;
}

function comoCertificamosHTML(bikes){
  const checkDiag = '<div>Diagnóstico digital de motor y batería (e-bikes)</div>';
  return HEAD('Cómo certificamos · Bike Trust', {path:'/como-certificamos', desc:'Cómo certificamos cada Specialized usada: inspección multipunto, diagnóstico de e-bikes (km de motor, salud de batería, ciclos) y estado honesto declarado de frente.'}) + TOPBAR + `
  <section class="cc-hero" style="background-image:linear-gradient(rgba(5,5,5,.74),rgba(5,5,5,.74)),url('/assets/img/workshop.jpg');background-size:cover;background-position:center">
    <div class="eyebrow">El estándar Bike Trust</div>
    <h1>Cómo certificamos</h1>
    <p>Comprar una bici usada no debería ser una apuesta. Por eso cada Specialized que vendemos pasa por un proceso que elimina la incertidumbre.</p>
  </section>
  <div class="cc-intro"><p>«Inspeccionada por mecánicos expertos, medida con datos reales y entregada con su estado honesto declarado de frente.»</p></div>
  <div class="cc-steps">
    <div class="cc-step"><div class="n">01 · Inspección mecánica</div><h3>Punto por punto</h3><p>Revisamos cuadro, dirección, transmisión, frenos, suspensión y ruedas. Limpiamos, afinamos y reemplazamos lo que haga falta antes de publicarla.</p></div>
    <div class="cc-step"><div class="n">02 · Diagnóstico digital</div><h3>Datos reales, no estimaciones</h3><p>En las e-bikes escaneamos el sistema Specialized: kilómetros del motor, salud de la batería y ciclos de carga. Lo que ves es lo que la bici realmente tiene.</p></div>
    <div class="cc-step"><div class="n">03 · Estado honesto</div><h3>Los defectos, de frente</h3><p>Declaramos cada rayón, marca o detalle real de la unidad. Preferimos que lo sepas antes de comprar: es la base de la confianza.</p></div>
    <div class="cc-step"><div class="n">04 · Entrega con respaldo</div><h3>Lista para rodar</h3><p>Te la entregamos afinada y a punto, con el respaldo de Bike Trust. <span style="color:var(--bronce)">[ Términos de garantía — por confirmar ]</span></p></div>
  </div>
  <div class="certblk" style="max-width:1080px;margin:50px auto 0">
    <div class="head"><svg class="shield" style="width:26px;height:30px"><use href="#sh"/></svg><h2>Qué revisamos en cada bici</h2></div>
    <div class="sub">Inspeccionada · Probada · Confiable</div>
    <div class="checks"><div>Integridad del cuadro verificada</div><div>Componentes inspeccionados</div><div>Transmisión limpiada y afinada</div><div>Suspensión revisada</div><div>Ruedas centradas</div>${checkDiag}</div>
    <p class="promise">Nos especializamos en Specialized usadas. Cada bici pasa por el taller de mecánicos expertos y se entrega con respaldo.</p>
  </div>
  <section class="ctaband">
    <div class="eyebrow">Tu próxima bici, con confianza</div>
    <h2>Agenda tu visita</h2>
    <p>Ven a ver y probar cualquier modelo del catálogo. Te lo dejamos preparado.</p>
    <div class="ctas" style="display:flex;gap:14px;justify-content:center;flex-wrap:wrap"><button type="button" class="btn-primary js-agendar">Agenda tu visita</button><a class="btn-ghost light" href="/#catalogo">Ver catálogo</a></div>
  </section>` + FOOT_OPEN + reservaModal(bikes) + '</body></html>';
}

/* ---------- página: catálogo completo ---------- */
function catalogoHTML(bikes){
  const discs = [...new Set(bikes.map(b=>b.disciplina).filter(Boolean))];
  const chips = discs.length>1
    ? `<div class="filters"><button class="chip on" data-f="*">Todas</button>${discs.map(d=>`<button class="chip" data-f="${esc(d)}">${esc(d)}</button>`).join('')}</div>` : '';
  const grid = bikes.length
    ? `<div class="grid">${bikes.map(cardHTML).join('')}</div>`
    : `<div class="empty">Pronto, bicis certificadas disponibles.</div>`;
  return HEAD('Catálogo · Bike Trust', {path:'/catalogo', desc:'Catálogo de bicicletas Specialized usadas y certificadas: MTB, ruta y urbanas, eléctricas y musculares. Cada una inspeccionada, con diagnóstico honesto y garantía.'}) + TOPBAR + `
  <div class="phead"><div class="eyebrow">El catálogo</div><h1>Todas nuestras bicis</h1><p>Specialized usadas, certificadas por Bike Trust. Filtra por disciplina y agenda tu visita.</p></div>
  <div id="catalogo" class="catwrap">${chips}${grid}</div>
  <div style="height:40px"></div>` + FOOT_OPEN + reservaModal(bikes) + `<script>${CATALOG_JS}</script></body></html>`;
}

/* ---------- página: consigna ---------- */
function consignaHTML(bikes){
  return HEAD('Consigna tu Specialized · Bike Trust', {path:'/consigna', desc:'Consigna tu Specialized con Bike Trust: la certificamos, la publicamos y la vendemos por ti. Tú defines el precio; nosotros ponemos la confianza.'}) + TOPBAR + `
  <section class="cc-hero" style="background-image:linear-gradient(rgba(5,5,5,.74),rgba(5,5,5,.74)),url('/assets/img/workshop.jpg');background-size:cover;background-position:center"><div class="eyebrow">Vende con nosotros</div><h1>Consigna tu Specialized</h1><p>Deja tu bici en manos de Bike Trust. La certificamos, la mostramos a compradores que confían en nuestra marca y la vendemos por ti.</p></section>
  <div class="cc-intro"><p>«Tú nos confías la bici; nosotros ponemos la certificación, la vitrina y los compradores.»</p></div>
  <div class="cc-steps">
    <div class="cc-step"><div class="n">01 · Conversamos</div><h3>Cuéntanos qué tienes</h3><p>Escríbenos por WhatsApp con el modelo, el año y el estado de tu Specialized. Te decimos si calza con lo que buscan nuestros compradores y un rango de precio realista.</p></div>
    <div class="cc-step"><div class="n">02 · Certificamos</div><h3>Pasa por el taller</h3><p>La inspeccionamos, la afinamos y —si es eléctrica— le hacemos el diagnóstico digital. Queda lista y con su estado honesto declarado.</p></div>
    <div class="cc-step"><div class="n">03 · Publicamos y mostramos</div><h3>La vitrina de Bike Trust</h3><p>La sumamos al catálogo y la mostramos a una audiencia que ya confía en nuestra certificación. Tú no lidias con compradores ni con visitas.</p></div>
    <div class="cc-step"><div class="n">04 · Se vende, te pagamos</div><h3>Tu parte, sin complicaciones</h3><p>Cuando se vende, te transferimos lo acordado. <span style="color:var(--bronce)">[ Comisión y condiciones — por confirmar ]</span></p></div>
  </div>
  <section class="ctaband"><div class="eyebrow">Empieza hoy</div><h2>¿Tienes una Specialized para vender?</h2><p>Cuéntanos qué tienes y te damos una orientación de precio, sin compromiso.</p><a class="btn-primary" href="https://wa.me/56985232895?text=Hola!%20Quiero%20consignar%20mi%20Specialized." target="_blank" rel="noopener">Conversemos por WhatsApp</a></section>` + FOOT_OPEN + reservaModal(bikes) + '</body></html>';
}

/* ---------- página: visítanos / contacto ---------- */
function visitanosHTML(bikes){
  const dir = 'Av. Las Condes 12461, Las Condes, Santiago';
  const mapsQ = `https://www.google.com/maps?q=${encodeURIComponent(dir)}`;
  const mapEmbed = `https://maps.google.com/maps?q=${encodeURIComponent(dir)}&z=15&output=embed`;
  return HEAD('Visítanos · Bike Trust', {path:'/visitanos', desc:'Visítanos en Las Condes, Santiago. Agenda y prueba en persona tu próxima Specialized usada y certificada.'}) + TOPBAR + `
  <div class="phead"><div class="eyebrow">Estamos en Santiago</div><h1>Visítanos</h1><p>Ven a ver y probar tu próxima Specialized. Si agendas tu visita, te recibimos con la bici preparada.</p></div>
  <div class="info2">
    <div class="det">
      <h3>La tienda</h3>
      <div class="irow"><span class="k">Dirección</span><span><a href="${mapsQ}" target="_blank" rel="noopener">${esc(dir)}</a></span></div>
      <div class="irow"><span class="k">Horario</span><span>Lunes a viernes · 10:00–19:00<br>Sábado · 10:00–14:00<br><span style="color:var(--bronce)">[ horario por confirmar ]</span></span></div>
      <div class="irow"><span class="k">Teléfono</span><span><a href="tel:+56985232895">+56 9 8523 2895</a></span></div>
      <div class="irow"><span class="k">WhatsApp</span><span><a href="https://wa.me/56985232895" target="_blank" rel="noopener">Escríbenos por WhatsApp</a></span></div>
      <div class="irow"><span class="k">Web</span><span>biketrust.cl</span></div>
      <div class="icta"><button type="button" class="btn-primary js-agendar">Agenda tu visita</button><a class="btn-ghost" href="/catalogo.html">Ver catálogo</a></div>
    </div>
    <div><div class="mapwrap"><iframe src="${mapEmbed}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Mapa · Bike Trust"></iframe></div>
      <a class="maplink" href="${mapsQ}" target="_blank" rel="noopener">Cómo llegar · abrir en Google Maps →</a></div>
  </div>
  <div style="height:48px"></div>` + FOOT_OPEN + reservaModal(bikes) + '</body></html>';
}

/* ---------- página: guía ---------- */
function guiaHTML(g, bikes){
  const secs = g.cuerpo.map(s=>`<h2>${esc(s[0])}</h2><p>${esc(s[1])}</p>`).join('');
  return HEAD(`${g.titulo} · Bike Trust`, {path:`/guias/${g.slug}`, type:'article', desc:g.resumen}) + TOPBAR + `
  <section class="cc-hero" style="background-image:linear-gradient(rgba(5,5,5,.76),rgba(5,5,5,.76)),url('/assets/img/${g.img}');background-size:cover;background-position:center"><div class="eyebrow">Guía Bike Trust</div><h1>${esc(g.titulo)}</h1></section>
  <article class="prose">
    <a class="back" href="/">← Volver al inicio</a>
    <p class="lead">${esc(g.lead)}</p>
    ${secs}
  </article>
  <section class="ctaband"><div class="eyebrow">¿Listo para elegir?</div><h2>Agenda tu visita</h2><p>Ven a ver y probar la bici que te interesa. Te asesoramos sin compromiso.</p><div class="ctas" style="display:flex;gap:14px;justify-content:center;flex-wrap:wrap"><button type="button" class="btn-primary js-agendar">Agenda tu visita</button><a class="btn-ghost light" href="/catalogo.html">Ver catálogo</a></div></section>` + FOOT_OPEN + reservaModal(bikes) + '</body></html>';
}

/* ---------- build ---------- */
// Asigna un slug único a cada bici. Sin colisión, la URL queda estable
// (modelo-talla); si dos comparten modelo+talla, se desambigua con -2, -3, …
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

// Resuelve b.fotos: slots numerados Foto 1..13 (adjunto descargado o URL), en orden.
// Respaldos: campo adjunto único «Fotos», luego «Fotos URLs». Defensivo: nunca rompe el build.
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
  const bikes = await fetchBikes();
  assignSlugs(bikes);
  const reservadas = await fetchReservedSlugs();
  for(const b of bikes) b.reservada = reservadas.has(b.slug);
  if(reservadas.size) console.log(`  · ${reservadas.size} modelo(s) con visita agendada`);
  await rm(OUT,{recursive:true,force:true});
  await mkdir(`${OUT}/bici`,{recursive:true});
  await mkdir(`${OUT}/guias`,{recursive:true});
  await mkdir(`${OUT}/ficha`,{recursive:true});
  await cp('assets/img', `${OUT}/assets/img`, {recursive:true}).catch(e=>console.warn('⚠  assets/img no copiado:', e.message));
  await resolveBikePhotos(bikes);
  await writeFile(`${OUT}/styles.css`, CSS);
  await writeFile(`${OUT}/index.html`, catalogHTML(bikes));
  await writeFile(`${OUT}/catalogo.html`, catalogoHTML(bikes));
  await writeFile(`${OUT}/como-certificamos.html`, comoCertificamosHTML(bikes));
  await writeFile(`${OUT}/consigna.html`, consignaHTML(bikes));
  await writeFile(`${OUT}/visitanos.html`, visitanosHTML(bikes));
  for(const g of GUIAS){
    await writeFile(`${OUT}/guias/${g.slug}.html`, guiaHTML(g, bikes));
  }
  for(const b of bikes){
    await writeFile(`${OUT}/bici/${b.slug}.html`, fichaHTML(b, bikes));
    await writeFile(`${OUT}/ficha/${b.slug}.html`, fichaTecnicaHTML(b));   // ficha técnica imprimible
  }
  // Producción / SEO: favicon (escudo), robots, sitemap y 404 on-brand.
  await writeFile(`${OUT}/favicon.svg`, FAVICON);
  await writeFile(`${OUT}/robots.txt`, `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
  await writeFile(`${OUT}/sitemap.xml`, sitemapXML(bikes));
  await writeFile(`${OUT}/404.html`, notFoundHTML());
  console.log(`✓ ${bikes.length} bici(s) · ${4+GUIAS.length} páginas + fichas · +SEO (og, sitemap, robots, favicon, 404) · sitio en /${OUT}`);
}
main().catch(e=>{ console.error(e); process.exit(1); });
