// build.mjs — Bike Trust · genera el sitio estático desde Airtable
// Lee la vista "Disponibles" y escribe /dist (catálogo + una ficha por bici).
// El token solo se usa aquí, en build (lado servidor). El sitio público es HTML estático.

import { mkdir, writeFile, rm } from 'node:fs/promises';

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

function mapBike(f){
  const motor = f['Motorización']||'';
  return {
    marca:f['Marca']||'', modelo:f['Modelo']||'', anio:f['Año']||'',
    electrica: motor.toLowerCase().startsWith('eléctr'),
    disciplina:f['Disciplina']||'', talla:f['Talla']||'',
    precio:num(f['Precio']), precioNuevo:num(f['Precio nuevo']),
    puntaje: (f['Puntaje certificación']??null),
    diagKm:num(f['Diag · km motor']), diagBat:num(f['Diag · salud batería']), diagCic:num(f['Diag · ciclos']),
    rangoAltura:f['Rango altura']||'', porQue:f['Por qué amarla']||'',
    estado:String(f['Estado honesto']||'').split('\n').map(s=>s.trim()).filter(Boolean),
    specs:parseSpecs(f['Specs clave']),
    referencia:f['Referencia']||'',
    fotos:String(f['Fotos URLs']||'').split(/[\n,]/).map(s=>s.trim()).filter(Boolean)
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
    out=out.concat(j.records.map(rec=>mapBike(rec.fields)));
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
      ['Modelos slug','Fecha','Estado'].forEach(f=>u.searchParams.append('fields[]', f));
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
        String(f['Modelos slug']||'').split(/[\n,]/).map(s=>s.trim()).filter(Boolean).forEach(s=>set.add(s));
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
.resv-note .d{flex:none;width:8px;height:8px;border-radius:50%;background:var(--bronce);margin-top:6px;animation:resvPulse 1.6s ease-in-out infinite}
.resv-note b{color:var(--bronce-deep);font-weight:600}
@media (max-width:620px){.resv-note{margin:0 24px 14px}}
/* ---------- landing (home estilo TPC · identidad Bike Trust) ---------- */
.nav2{position:sticky;top:0;z-index:50;background:var(--blanco);border-bottom:1px solid var(--linea)}
.nav2 .in{max-width:1180px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:15px 28px}
.nav2 .links{display:flex;align-items:center;gap:28px}
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
.foot2 .in{max-width:1180px;margin:0 auto;display:grid;grid-template-columns:1.5fr 1fr 1.4fr;gap:30px;padding:46px 28px}
.foot2 .ftag{font-size:.82rem;color:var(--gris);margin-top:12px;line-height:1.55;max-width:30ch}
.foot2 .fcol h4{font-size:.64rem;letter-spacing:.2em;text-transform:uppercase;color:var(--bronce);margin-bottom:14px}
.foot2 .fcol a,.foot2 .fcol .flink{display:block;font-size:.84rem;color:var(--gris);margin-bottom:9px;background:none;border:0;padding:0;cursor:pointer;font-family:var(--sans);letter-spacing:0;text-transform:none;text-align:left}
.foot2 .fcol a:hover,.foot2 .fcol .flink:hover{color:var(--carbon)}
.foot2 .fcontact{font-size:.84rem;color:var(--gris);line-height:1.75}
.foot2 .legal{border-top:1px solid var(--linea);text-align:center;font-size:.7rem;color:var(--gris);padding:16px 28px}
@media(max-width:680px){.foot2 .in{grid-template-columns:1fr;gap:26px}}
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
`;

const HEAD = t => `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(t)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Jost:wght@300;400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css"></head><body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="sh" viewBox="0 0 32 36"><path d="M4 6 Q4 3 7 3 H25 Q28 3 28 6 V20 Q28 23.5 25.4 25.2 L16 32 L6.6 25.2 Q4 23.5 4 20 Z"/></symbol></svg>`;
const TOPBAR = `<header class="nav2"><div class="in">
  <a class="lock" href="/"><svg class="shield"><use href="#sh"/></svg><span><b>BIKE</b> TRUST</span></a>
  <nav class="links">
    <a href="/#catalogo">Catálogo</a>
    <a href="/como-certificamos.html">Cómo certificamos</a>
    <button type="button" class="navcta js-agendar">Agenda tu visita</button>
  </nav>
</div></header>`;
const FOOT = `<footer class="foot2"><div class="in">
  <div class="fcol"><a class="lock" href="/"><svg class="shield"><use href="#sh"/></svg><span><b>BIKE</b> TRUST</span></a>
    <p class="ftag">Bicicletas Specialized usadas, certificadas. Santiago, Chile.</p></div>
  <div class="fcol"><h4>Explora</h4><a href="/#catalogo">Catálogo</a><a href="/como-certificamos.html">Cómo certificamos</a><button type="button" class="flink js-agendar">Agenda tu visita</button></div>
  <div class="fcol fcontact"><h4>Visítanos</h4>Av. Las Condes 12461, Las Condes<br>Santiago · Chile<br>+56 9 8523 2895<br>biketrust.cl</div>
</div><div class="legal">© Bike Trust · Specialized usadas certificadas</div></footer></body></html>`;
const FOOT_OPEN = FOOT.replace('</body></html>','');

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
    var dt=q('.rsv-date'); dt.min=ymd(new Date()); dt.max=ymd(maxBizDate());
    ov.classList.add('open'); document.body.style.overflow='hidden';
    setStep(1);
  }
  function closeModal(){ ov.classList.remove('open'); document.body.style.overflow=''; }
  bNext.addEventListener('click',function(){
    var v=q('.rsv-date').value;
    if(!v) return err('.rsv-err1','Elige una fecha.');
    if(v<ymd(new Date())) return err('.rsv-err1','Elige una fecha de hoy en adelante.');
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
      modelosSlug:sel.map(function(c){return c.value;}), nombre:nombre, email:email, telefono:tel };
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
    return `<label class="rsv-model"><input type="checkbox" class="rsv-cb" value="${esc(b.slug)}" data-label="${label}"><span class="rsv-check"></span><span class="rsv-mtxt"><span class="rsv-mname">${esc(b.modelo)}</span><span class="rsv-mmeta">${esc(meta)}</span></span></label>`;
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
function fichaHTML(b, bikes){
  const anchor = b.precioNuevo ? `Valor nueva: <s>${clp(b.precioNuevo)}</s>`
                               : `Valor nueva: <s>$ — · — · —</s><span class="pend">por confirmar</span>`;
  const puntaje = (b.puntaje!=null?b.puntaje:'—')+`<span style="font-size:.9rem;color:var(--gris)">/100</span>`;
  const puntajePend = b.puntaje!=null ? '' : '<br><span style="color:var(--bronce)">por confirmar</span>';
  const ribbon = [['Talla',b.talla],['Estatura',b.rangoAltura||'—'],['Disciplina',b.disciplina],['Año',b.anio||'—']]
    .map(r=>`<div><div class="k">${esc(r[0])}</div><div class="v">${esc(r[1])}</div></div>`).join('');
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
  // Placeholders para campos editoriales aún vacíos (mismo lenguaje que Estado honesto).
  const whyP = b.porQue ? esc(b.porQue)
    : `<span style="color:var(--gris)">[ Una frase que enamore — por completar ]</span>`;
  const specsBlock = b.specs.length ? `<div class="specs">${specs}</div>`
    : `<p style="font-size:.74rem;color:var(--gris);font-style:italic">Pendiente: completar el campo «Specs clave» en Airtable.</p>`;
  const hero = b.fotos[0] ? `<div class="hero-ph"><img src="${esc(b.fotos[0])}" alt="${esc(b.modelo)}"></div>`
                          : `<div class="hero-ph ph-box"><div class="pl">Foto héroe</div><div class="pd">Bici completa · lado motriz · fondo limpio</div></div>`;
  const galLabels=[['Detalle','Motor / componentes'],['Detalle','Suspensión / cockpit'],['Desgaste','Honesto · primer plano']];
  const gallery = galLabels.map((l,i)=> b.fotos[i+1]
      ? `<img src="${esc(b.fotos[i+1])}" alt="">`
      : `<div class="ph-box"><div class="pl">${l[0]}</div><div class="pd">${l[1]}</div></div>`).join('');
  const checkDiag = b.electrica ? '<div>Diagnóstico digital de motor y batería</div>' : '';
  const resvNote = b.reservada
    ? `<div class="resv-note"><span class="d"></span><div><b>Alguien agendó una visita para verla.</b> Sigue disponible — agenda la tuya y no te quedes fuera.</div></div>`
    : '';

  return HEAD(`${b.marca} ${b.modelo} · Bike Trust`) + TOPBAR + `
<article class="ficha">
  <a class="back" href="/">← Volver al catálogo</a>
  <div class="title"><div class="kicker">${esc([b.disciplina,b.anio,b.referencia&&'Ref '+b.referencia].filter(Boolean).join(' · '))}</div>
    <h1><span class="brandname">${esc(b.marca)}</span>${esc(b.modelo)}</h1></div>
  ${hero}
  <div class="gallery">${gallery}</div>
  <div class="price"><div><div class="anchor">${anchor}</div><div class="now">${b.precio!=null?clp(b.precio):'Consultar'}</div></div>
    <div class="cert"><div class="s">${puntaje}</div><div class="l">Puntaje<br>certificación${puntajePend}</div></div></div>
  ${resvNote}
  <button type="button" class="cta js-agendar" data-slug="${esc(b.slug)}">Agenda tu visita</button>
  <div class="ribbon">${ribbon}</div>
  <div class="why"><div class="src">Por qué amarla</div><p>${whyP}</p></div>
  ${diag}
  <div class="sec"><div class="lead">Estado honesto · notas del mecánico</div><div class="honest"><ul>${estadoLis}</ul>${estadoNote}</div></div>
  <div class="sec" style="padding-top:8px"><div class="lead">Especificaciones</div>${specsBlock}</div>
  <div class="certblk"><div class="head"><svg class="shield" style="width:26px;height:30px"><use href="#sh"/></svg><h2>Certificada por Bike Trust</h2></div>
    <div class="sub">Inspeccionada · Probada · Confiable</div>
    <div class="checks"><div>Integridad del cuadro verificada</div><div>Componentes inspeccionados</div><div>Transmisión limpiada y afinada</div><div>Suspensión revisada</div><div>Ruedas centradas</div>${checkDiag}</div>
    <p class="promise">Nos especializamos en Specialized usadas. Cada bici pasa por el taller de mecánicos expertos y se entrega con respaldo. <span style="color:var(--bronce)">[ Términos de garantía — por confirmar ]</span></p></div>
</article>
${FOOT_OPEN}${reservaModal(bikes)}</body></html>`;
}

/* ---------- catálogo ---------- */
function cardHTML(b){
  const url=`/bici/${b.slug}.html`;
  const img = b.fotos[0] ? `<img src="${esc(b.fotos[0])}" alt="${esc(b.modelo)}">` : `<div class="ph">Foto pendiente</div>`;
  const tag = b.reservada ? `<div class="resv-tag">Reservada</div>` : '';
  return `<a class="card" href="${url}" data-disc="${esc(b.disciplina)}"><div class="img">${tag}${img}</div><div class="body">
    <div class="disc">${esc(b.disciplina)}${b.talla?' · Talla '+esc(b.talla):''}</div>
    <h3>${esc(b.modelo)}</h3>
    <div class="meta">${esc(b.marca)}${b.anio?' · '+esc(b.anio):''}</div>
    <div class="foot"><div class="price">${b.precio!=null?clp(b.precio):'Consultar'}</div>
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
  [].forEach.call(document.querySelectorAll('.tile'),function(t){
    t.addEventListener('click',function(e){ e.preventDefault(); filtrar(t.getAttribute('data-f'));
      var cat=document.getElementById('catalogo'); if(cat) cat.scrollIntoView({behavior:'smooth'}); });
  });
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
  const slide = (eb,h2,p,cta,ph)=>`<div class="hslide"><div class="htext"><div class="eyebrow">${esc(eb)}</div><h2>${esc(h2)}</h2><p>${esc(p)}</p>${cta}</div><div class="himg">${SHIELD}<div class="ph">${esc(ph)}</div></div></div>`;
  const hero = `<section class="hcar"><div class="hcar-track">
    ${slide('Specialized usadas · certificadas','Confianza sobre dos ruedas','Bicicletas Specialized de segunda mano, inspeccionadas por mecánicos expertos. Compra usado con la tranquilidad de lo nuevo.',`<a class="btn-primary" style="background:var(--bronce-deep)" href="#catalogo">Ver catálogo</a>`,'Foto destacada · bici héroe')}
    ${slide('Nuestro estándar','Cada bici, certificada','Inspección mecánica, diagnóstico digital real y estado honesto declarado de frente.',`<a class="btn-ghost light" href="/como-certificamos.html">Cómo certificamos</a>`,'Taller · proceso de certificación')}
    ${slide('Visítanos en Santiago','Ven a verla en persona','Agenda una visita y te dejamos la bici preparada para que la veas y la pruebes.',`<button type="button" class="btn-primary js-agendar" style="background:var(--bronce-deep)">Agenda tu visita</button>`,'Tienda · Las Condes, Santiago')}
  </div><button type="button" class="hprev" aria-label="Anterior">‹</button><button type="button" class="hnext" aria-label="Siguiente">›</button>
  <div class="hdots">${[0,1,2].map((_,i)=>`<button type="button" class="hdot${i===0?' on':''}" aria-label="Slide ${i+1}"></button>`).join('')}</div></section>`;
  const tiles = discs.length ? `<section style="padding-top:0">
    <div class="sec-head"><div class="eyebrow">Explora</div><h2>Por disciplina</h2></div>
    <div class="tiles">${discs.slice(0,3).map(d=>`<a class="tile" data-f="${esc(d)}" href="#catalogo"><div class="ph">Foto ${esc(d)}</div><div class="ov"><h3>${esc(d)}</h3><span>Ver</span></div></a>`).join('')}</div>
  </section>` : '';
  const ebikesSec = ebikes.length>=2 ? `<section>
    <div class="sec-head"><div class="eyebrow">Con motor</div><h2>E-bikes certificadas</h2><p>Con diagnóstico digital de motor y batería: datos reales de cada unidad.</p></div>
    ${carousel(ebikes.map(cardHTML).join(''))}
  </section>` : '';
  const GUIDES = [
    ['Cómo leer el diagnóstico','Qué significan los kilómetros del motor, la salud de la batería y los ciclos en una e-bike usada.'],
    ['Eléctrica o muscular','Cómo elegir entre una e-bike y una bici tradicional según tu uso, tu ruta y tu presupuesto.'],
    ['Qué es el estado honesto','Por qué declaramos cada rayón y detalle real antes de que compres. La confianza parte por ahí.']
  ];
  const guides = GUIDES.map(g=>`<div class="guide"><div class="gimg">Foto guía</div><div class="gbody"><div class="glabel">Guía</div><h3>${esc(g[0])}</h3><p>${esc(g[1])}</p><a href="/como-certificamos.html">Leer más</a></div></div>`).join('');
  return HEAD('Bike Trust · Specialized usadas certificadas') +
  `<div class="annbar"><b>Specialized usadas certificadas</b> · Visítanos en Las Condes, Santiago <button type="button" class="ab-link js-agendar">Agenda tu visita</button></div>` +
  TOPBAR + hero + `
  <section id="catalogo">
    <div class="sec-head"><div class="eyebrow">El catálogo</div><h2>Nuestras bicis</h2><p>Cada una, certificada por Bike Trust y lista para rodar.</p></div>
    ${chips}
    ${catalogo}
  </section>
  <section class="brandstory">
    <div class="eyebrow">Bike Trust</div>
    <h2>La forma confiable de comprar usado</h2>
    <p>Nos especializamos en bicicletas Specialized de segunda mano. Cada una pasa por nuestro taller, se mide con datos reales y se entrega con su estado honesto declarado. Así compras usado sin apostar.</p>
    <div class="ctas"><a class="btn-primary" href="/como-certificamos.html">Cómo certificamos</a><a class="btn-ghost" href="#catalogo">Ver catálogo</a></div>
  </section>
  ${tiles}
  <div class="promo"><div class="in">
    <div class="pimg">Foto · consignación</div>
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
  return HEAD('Cómo certificamos · Bike Trust') + TOPBAR + `
  <section class="cc-hero">
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

async function main(){
  const bikes = await fetchBikes();
  assignSlugs(bikes);
  const reservadas = await fetchReservedSlugs();
  for(const b of bikes) b.reservada = reservadas.has(b.slug);
  if(reservadas.size) console.log(`  · ${reservadas.size} modelo(s) con visita agendada`);
  await rm(OUT,{recursive:true,force:true});
  await mkdir(`${OUT}/bici`,{recursive:true});
  await writeFile(`${OUT}/styles.css`, CSS);
  await writeFile(`${OUT}/index.html`, catalogHTML(bikes));
  await writeFile(`${OUT}/como-certificamos.html`, comoCertificamosHTML(bikes));
  for(const b of bikes){
    await writeFile(`${OUT}/bici/${b.slug}.html`, fichaHTML(b, bikes));
  }
  console.log(`✓ ${bikes.length} bici(s) · sitio generado en /${OUT}`);
}
main().catch(e=>{ console.error(e); process.exit(1); });
