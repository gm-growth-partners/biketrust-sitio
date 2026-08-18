// Prueba el payload plano de bici de mc-evento.js ejecutando el CÓDIGO REAL
// extraído del archivo, contra registros reales de Inventario (sin tocar la base).
import { readFileSync } from 'node:fs';

const P = new URL('../functions/api/mc-evento.js', import.meta.url);
const src = readFileSync(P, 'utf-8');

// Extraer los helpers de nivel módulo tal cual están escritos.
const grab = (re, name) => { const m = src.match(re); if (!m) throw new Error('no encontré ' + name); return m[0]; };
const helpers = [
  grab(/const slugify = [\s\S]*?\.replace\(\/\^-\+\|-\+\$\/g, ''\);/, 'slugify'),
  grab(/const clp = .*;/, 'clp'),
  grab(/function areaMasBaja\(desglose\) \{[\s\S]*?\n\}/, 'areaMasBaja'),
].join('\n');

// El bloque que arma `bici` vive dentro del handler; se extrae y se envuelve.
const blockStart = src.indexOf('      const f = (await br.json()).fields || {};');
const blockEnd = src.indexOf('      };', src.indexOf('biciKmMotor')) + '      };'.length;
if (blockStart < 0 || blockEnd < 10) throw new Error('no encontré el bloque de bici');
const block = src.slice(blockStart, blockEnd).replace('const f = (await br.json()).fields || {};', 'const f = FIELDS;');

const build = new Function('FIELDS', 'SITE', `
  ${helpers}
  let bici = {};
  ${block}
  return bici;
`);

// Registros REALES de Inventario (leídos por API hoy).
const CASOS = [
  { nombre: 'Levo SL S-Works · M (e-bike, reel "SL")', f: {
    Etiqueta: 'Specialized Levo SL S-Works · M', Modelo: 'Levo SL S-Works', Talla: 'M', 'Año': 2022,
    Precio: 3500000, 'Precio nuevo': 7200000, Estado: 'Disponible', 'Motorización': 'Eléctrica',
    'Puntaje certificación': 6.4, 'Desglose puntaje': 'Frenos 6,8 · Transmisión 6,5 · Suspensión 5,9',
    'Estado honesto': 'Rayón de 3 cm en el tubo inferior. Transmisión cambiada a los 1.200 km.',
    'Rango altura': '1,65 – 1,78 m', 'Diag · salud batería': 0.91, 'Diag · ciclos': 214, 'Diag · km motor': 2840,
    'Fotos galería': [{ url: 'https://x/f.jpg', thumbnails: { large: { url: 'https://x/large.jpg' } } }],
  }},
  { nombre: 'Epic 8 Pro · L (muscular, reel estrella)', f: {
    Etiqueta: 'Specialized Epic 8 Pro · L', Modelo: 'Epic 8 Pro', Talla: 'L',
    Precio: 6500000, 'Precio nuevo': 9800000, Estado: 'Disponible', 'Motorización': 'Muscular',
    'Puntaje certificación': 6.8, 'Desglose puntaje': 'Frenos 7,0\nTransmisión 6,9\nSuspensión 6,4',
    'Estado honesto': 'Impecable. Uso de 2 temporadas de XC.', 'Rango altura': '1,78 – 1,88 m',
  }},
  { nombre: 'Bici VENDIDA (debe bifurcar)', f: {
    Etiqueta: 'Specialized Tarmac SL7 S-Works · ', Modelo: 'Tarmac SL7 S-Works', Talla: '',
    Precio: 6000000, Estado: 'Vendida', 'Motorización': 'Muscular', 'Puntaje certificación': 6.2,
  }},
  { nombre: 'Ficha incompleta (no debe romper)', f: { Modelo: 'Kenevo Comp', Talla: 'S3', Estado: 'Disponible' } },
  // Registros REALES cargados 2026-08-18. El desglose perfecto es el caso que
  // rompía el copy: decía «Donde perdió puntos: Cuadro y Estructura» de una 7/7.
  { nombre: 'Stumpjumper 15 Alloy · S4 (7/7 en TODO → sin área más baja)', f: {
    Etiqueta: 'Specialized Stumpjumper 15 Alloy · S4', Modelo: 'Stumpjumper 15 Alloy', Talla: 'S4',
    Precio: 2000000, Estado: 'Disponible', 'Motorización': 'Muscular', 'Puntaje certificación': 7,
    'Desglose puntaje': 'Cuadro y Estructura: 7/7\nTransmisión y Componentes: 7/7\nSuspensiones: 7/7\nFrenos: 7/7',
    'Estado honesto': 'Prácticamente nueva: una sola salida real de uso.', 'Rango altura': '173 a 188 cm',
  }},
  { nombre: 'Kenevo Expert 6Fattie · S3 (empate en el mínimo → sí hay área más baja)', f: {
    Etiqueta: 'Specialized Kenevo Expert 6Fattie · S3', Modelo: 'Kenevo Expert 6Fattie', Talla: 'S3',
    Precio: 3900000, Estado: 'Disponible', 'Motorización': 'Eléctrica', 'Puntaje certificación': 6.8,
    'Desglose puntaje': 'Cuadro y Estructura: 6.9/7\nMotor y Electrónica: 6.9/7\nSuspensiones: 6.8/7\nFrenos y Componentes: 6.8/7',
    'Estado honesto': 'Cuadro en muy buen estado, con mejoras premium.', 'Rango altura': '165 a 180 cm',
    'Diag · salud batería': 0.99, 'Diag · ciclos': 34, 'Diag · km motor': 1401.22,
  }},
];

let fail = 0;
for (const c of CASOS) {
  const b = build(c.f, 'https://biketrust-sitio.pages.dev');
  console.log('\n=== ' + c.nombre);
  for (const k of ['biciModelo','biciPuntaje','biciAreaBaja','biciAreaBajaLinea','biciPrecio','biciPrecioNuevo','biciAhorro','biciRangoAltura','biciFicha','biciEstado','biciDisponible','biciBateria','biciCiclos','biciKmMotor'])
    if (b[k] !== '' && b[k] !== undefined) console.log('  ' + k + ':', b[k]);
}

// Aserciones sobre lo que el copy necesita.
const sl = build(CASOS[0].f, 'https://s');
const epic = build(CASOS[1].f, 'https://s');
const vend = build(CASOS[2].f, 'https://s');
const inc = build(CASOS[3].f, 'https://s');
const perfecta = build(CASOS[4].f, 'https://s');
const kenevo = build(CASOS[5].f, 'https://s');
const check = (ok, msg) => { if (!ok) { console.log('FALLO: ' + msg); fail++; } };

console.log('\n--- ASERCIONES ---');
check(sl.biciAreaBaja === 'Suspensión' && sl.biciAreaBajaLinea.includes('5,9'), 'area mas baja con separador ·');
check(epic.biciAreaBaja === 'Suspensión', 'area mas baja con saltos de linea');
// Fix 2026-08-18: sin un área por debajo de otra, el campo va vacío y ManyChat
// omite el renglón. Antes salía «Donde perdió puntos: Cuadro y Estructura» en 7/7.
check(perfecta.biciAreaBaja === '' && perfecta.biciAreaBajaLinea === '',
  'desglose 7/7 parejo NO nombra area, dio "' + perfecta.biciAreaBaja + '"');
check(perfecta.biciPuntaje === '7', 'la 7/7 igual trae puntaje, dio ' + perfecta.biciPuntaje);
check(kenevo.biciAreaBaja === 'Suspensiones',
  'empate en el minimo igual nombra area, dio "' + kenevo.biciAreaBaja + '"');
check(kenevo.biciBateria === '99' && kenevo.biciCiclos === '34', 'diagnostico e-bike Kenevo');
check(sl.biciAhorro === '$3.700.000', 'ahorro e-bike, dio ' + sl.biciAhorro);
check(epic.biciAhorro === '$3.300.000', 'ahorro muscular, dio ' + epic.biciAhorro);
check(sl.biciPuntaje === '6,4', 'puntaje con coma, dio ' + sl.biciPuntaje);
check(sl.biciBateria === '91' && sl.biciCiclos === '214', 'diagnostico bateria e-bike');
check(epic.biciBateria === '' && epic.biciCiclos === '', 'muscular NO trae bateria');
check(sl.biciFicha === 'https://s/ficha/levo-sl-s-works-m', 'slug ficha, dio ' + sl.biciFicha);
// Como PALABRA, no booleano: el mapeo de ManyChat no guarda booleanos en
// campos de texto (fix 2026-07-30, mismo contrato que cf_match).
check(vend.biciDisponible === 'false' && vend.biciEstado === 'Vendida', 'bici vendida bifurca');
check(sl.biciDisponible === 'true', 'bici disponible');
check(inc.biciAhorro === '' && inc.biciPuntaje === '' && inc.biciAreaBaja === '', 'ficha incompleta no rompe');
check(inc.biciFicha === 'https://s/ficha/kenevo-comp-s3', 'slug con ficha incompleta');
console.log(fail === 0 ? '\nTODAS OK' : `\n${fail} FALLOS`);
process.exit(fail === 0 ? 0 : 1);
