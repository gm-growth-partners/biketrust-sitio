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

async function fetchBikes(){
  if(!TOKEN){ console.warn('⚠  Sin AIRTABLE_TOKEN — usando datos de ejemplo (mock).'); return MOCK.map(mapBike); }
  let out=[], offset;
  do{
    const u=new URL(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE)}`);
    u.searchParams.set('view', VIEW);
    if(offset) u.searchParams.set('offset', offset);
    const r=await fetch(u,{headers:{Authorization:`Bearer ${TOKEN}`}});
    if(!r.ok) throw new Error(`Airtable ${r.status}: ${await r.text()}`);
    const j=await r.json();
    out=out.concat(j.records.map(rec=>mapBike(rec.fields)));
    offset=j.offset;
  } while(offset);
  return out;
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
.card .img{height:200px;background:var(--hueso);overflow:hidden;display:flex;align-items:center;justify-content:center;border-bottom:1px solid var(--linea)}
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
.cta{display:block;text-align:center;background:var(--carbon);color:#fff;font-weight:500;letter-spacing:.18em;text-transform:uppercase;font-size:.78rem;padding:17px;margin:0 46px}.cta:hover{background:var(--bronce-deep)}
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
@media print{body{background:#fff}.ficha{box-shadow:none}}
`;

const HEAD = t => `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(t)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Jost:wght@300;400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css"></head><body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="sh" viewBox="0 0 32 36"><path d="M4 6 Q4 3 7 3 H25 Q28 3 28 6 V20 Q28 23.5 25.4 25.2 L16 32 L6.6 25.2 Q4 23.5 4 20 Z"/></symbol></svg>`;
const TOPBAR = `<div class="topbar"><div class="in"><a class="lock" href="/"><svg class="shield"><use href="#sh"/></svg><span><b>BIKE</b> TRUST</span></a><div class="nav">Specialized certificadas</div></div></div>`;
const FOOT = `<div class="foot"><a class="lock" href="/"><svg class="shield"><use href="#sh"/></svg><span><b>BIKE</b> TRUST</span></a><div class="c">Av. Las Condes 12461, Las Condes · Santiago<br>+56 9 8523 2895 · biketrust.cl</div></div></body></html>`;

/* ---------- ficha ---------- */
function fichaHTML(b){
  const url = `/bici/${slug(b.modelo+'-'+b.talla)}.html`;
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
  const hero = b.fotos[0] ? `<div class="hero-ph"><img src="${esc(b.fotos[0])}" alt="${esc(b.modelo)}"></div>`
                          : `<div class="hero-ph ph-box"><div class="pl">Foto héroe</div><div class="pd">Bici completa · lado motriz · fondo limpio</div></div>`;
  const galLabels=[['Detalle','Motor / componentes'],['Detalle','Suspensión / cockpit'],['Desgaste','Honesto · primer plano']];
  const gallery = galLabels.map((l,i)=> b.fotos[i+1]
      ? `<img src="${esc(b.fotos[i+1])}" alt="">`
      : `<div class="ph-box"><div class="pl">${l[0]}</div><div class="pd">${l[1]}</div></div>`).join('');
  const checkDiag = b.electrica ? '<div>Diagnóstico digital de motor y batería</div>' : '';

  return HEAD(`${b.marca} ${b.modelo} · Bike Trust`) + TOPBAR + `
<article class="ficha">
  <a class="back" href="/">← Volver al catálogo</a>
  <div class="title"><div class="kicker">${esc([b.disciplina,b.anio,b.referencia&&'Ref '+b.referencia].filter(Boolean).join(' · '))}</div>
    <h1><span class="brandname">${esc(b.marca)}</span>${esc(b.modelo)}</h1></div>
  ${hero}
  <div class="gallery">${gallery}</div>
  <div class="price"><div><div class="anchor">${anchor}</div><div class="now">${b.precio!=null?clp(b.precio):'Consultar'}</div></div>
    <div class="cert"><div class="s">${puntaje}</div><div class="l">Puntaje<br>certificación${puntajePend}</div></div></div>
  <a class="cta" href="#">Agenda tu visita</a>
  <div class="ribbon">${ribbon}</div>
  <div class="why"><div class="src">Por qué amarla</div><p>${esc(b.porQue)}</p></div>
  ${diag}
  <div class="sec"><div class="lead">Estado honesto · notas del mecánico</div><div class="honest"><ul>${estadoLis}</ul>${estadoNote}</div></div>
  <div class="sec" style="padding-top:8px"><div class="lead">Especificaciones</div><div class="specs">${specs}</div></div>
  <div class="certblk"><div class="head"><svg class="shield" style="width:26px;height:30px"><use href="#sh"/></svg><h2>Certificada por Bike Trust</h2></div>
    <div class="sub">Inspeccionada · Probada · Confiable</div>
    <div class="checks"><div>Integridad del cuadro verificada</div><div>Componentes inspeccionados</div><div>Transmisión limpiada y afinada</div><div>Suspensión revisada</div><div>Ruedas centradas</div>${checkDiag}</div>
    <p class="promise">Nos especializamos en Specialized usadas. Cada bici pasa por el taller de mecánicos expertos y se entrega con respaldo. <span style="color:var(--bronce)">[ Términos de garantía — por confirmar ]</span></p></div>
  ${FOOT.replace('</body></html>','')}
</article></body></html>`;
}

/* ---------- catálogo ---------- */
function cardHTML(b){
  const url=`/bici/${slug(b.modelo+'-'+b.talla)}.html`;
  const img = b.fotos[0] ? `<img src="${esc(b.fotos[0])}" alt="${esc(b.modelo)}">` : `<div class="ph">Foto pendiente</div>`;
  return `<a class="card" href="${url}"><div class="img">${img}</div><div class="body">
    <div class="disc">${esc(b.disciplina)}${b.talla?' · Talla '+esc(b.talla):''}</div>
    <h3>${esc(b.modelo)}</h3>
    <div class="meta">${esc(b.marca)}${b.anio?' · '+esc(b.anio):''}</div>
    <div class="foot"><div class="price">${b.precio!=null?clp(b.precio):'Consultar'}</div>
      <div class="badge"><svg class="shield" style="width:14px;height:16px"><use href="#sh"/></svg>Certificada</div></div>
  </div></a>`;
}
function catalogHTML(bikes){
  const grid = bikes.length
    ? `<div class="grid">${bikes.map(cardHTML).join('')}</div>`
    : `<div class="empty">Pronto, bicis certificadas disponibles.</div>`;
  return HEAD('Bike Trust · Specialized certificadas') + TOPBAR + `
  <div class="hero"><div class="eyebrow">Specialized usadas · certificadas</div>
    <h1>Confianza sobre dos ruedas</h1>
    <p>Cada bici, inspeccionada por mecánicos expertos y entregada con respaldo. Diagnóstico real, estado honesto, sin sorpresas.</p></div>
  <div class="wrap">${grid}</div>` + FOOT;
}

/* ---------- build ---------- */
async function main(){
  const bikes = await fetchBikes();
  await rm(OUT,{recursive:true,force:true});
  await mkdir(`${OUT}/bici`,{recursive:true});
  await writeFile(`${OUT}/styles.css`, CSS);
  await writeFile(`${OUT}/index.html`, catalogHTML(bikes));
  for(const b of bikes){
    await writeFile(`${OUT}/bici/${slug(b.modelo+'-'+b.talla)}.html`, fichaHTML(b));
  }
  console.log(`✓ ${bikes.length} bici(s) · sitio generado en /${OUT}`);
}
main().catch(e=>{ console.error(e); process.exit(1); });
