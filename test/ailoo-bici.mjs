// Test offline del puente Ailoo → Inventario. Corre con: node test/ailoo-bici.mjs
//
// Cubre tres cosas:
//   1. El mapeo puro (números y líneas sueltas → campos de Airtable).
//   2. Las respuestas del contrato publicado a Ailoo (?dry=1, 400, 401).
//   3. IDA Y VUELTA: los strings que componemos se le pasan a los parsers REALES
//      de build.mjs y mc-match.js (extraídos del archivo, no reescritos acá) para
//      comprobar que lo que escribimos es exactamente lo que el sitio y el bot
//      saben leer. Si alguien toca `parseSpecs` o `parseRangoAltura`, este test
//      cae y avisa antes de que se rompa una ficha en producción.

import { readFileSync } from 'node:fs';
import {
  mapearAiloo, componerRangoAltura, componerDesglose, componerSpecs,
  estadoSegunStock, onRequestPost, onRequestGet,
} from '../functions/api/ailoo-bici.js';

let fallos = 0;
const ok = (cond, nombre, extra = '') => {
  if (cond) { console.log(`  ✓ ${nombre}`); }
  else { console.log(`  ✗ ${nombre}${extra ? ' → ' + extra : ''}`); fallos++; }
};
const eq = (a, b, nombre) => ok(a === b, nombre, `esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`);

// ── Parsers reales, extraídos del código de producción ──────────────────────
const grab = (src, re, name) => { const m = src.match(re); if (!m) throw new Error('no encontré ' + name); return m[0]; };
const buildSrc = readFileSync(new URL('../build.mjs', import.meta.url), 'utf-8');
const matchSrc = readFileSync(new URL('../functions/api/mc-match.js', import.meta.url), 'utf-8');
const parseSpecs = new Function(`${grab(buildSrc, /function parseSpecs\(raw\)\{[\s\S]*?\n\}/, 'parseSpecs')}; return parseSpecs;`)();
const desgloseRow = new Function(`${grab(buildSrc, /function desgloseRow\(\[k,v\]\)\{[\s\S]*?\n\}/, 'desgloseRow')}; return desgloseRow;`)();
const parseRangoAltura = new Function(`${grab(matchSrc, /function parseRangoAltura\(s\) \{[\s\S]*?\n\}/, 'parseRangoAltura')}; return parseRangoAltura;`)();

// ── El envío de ejemplo del requerimiento (Epic 8 Pro, referencia real) ─────
const EPIC = {
  evento: 'producto.creado',
  referencia: '4082552',
  marca: 'Specialized', modelo: 'Epic 8 Pro', anio: 2024, talla: 'l',
  motorizacion: 'muscular', disciplina: 'mtb', color: 'Azul',
  precio: 6500000, precio_nuevo: 8000000,
  altura_min_cm: 178, altura_max_cm: 188,
  puntaje: 6.8,
  nota_cuadro: 7.0, nota_suspensiones: 6.5, nota_frenos_transmision: 6.8, nota_electronica: 7.0,
  material_cuadro: 'Carbono FACT 11m',
  componentes: 'Suspensión: sistema Brain inteligente\nCuadro: Carbono FACT 11m',
  mejoras: 'Ruedas: Roval Control SL carbono\nTija: SRAM Reverb AXS (electrónica)',
  estado_honesto: 'Excelente estado cosmético y mecánico, muy poco uso.',
  por_que_amarla: 'La Epic es el referente indiscutido del XC de competencia.',
  stock: 1,
  fotos: ['https://biketrust.cl/a_900.jpeg', 'https://biketrust.cl/b_900.jpeg'],
};

console.log('\n— 1. Mapeo del envío de ejemplo —');
const m = mapearAiloo(EPIC);
eq(m.referencia, '4082552', 'referencia');
eq(m.fields['Modelo'], 'Epic 8 Pro', 'modelo');
eq(m.fields['Talla'], 'L', 'talla se normaliza a mayúscula');
eq(m.fields['Motorización'], 'Muscular', 'motorización → opción exacta del select');
eq(m.fields['Disciplina'], 'MTB', 'disciplina → opción exacta del select');
eq(m.fields['Color'], 'Azul', 'color');
eq(m.fields['Precio'], 6500000, 'precio');
eq(m.fields['Rango altura'], '178 a 188 cm', 'rango de altura compuesto');
eq(m.fields['Puntaje certificación'], 6.8, 'puntaje');
eq(m.fotos.length, 2, 'fotos válidas');
eq(m.avisos.length, 0, 'sin avisos');

console.log('\n— 2. Desglose: orden y formato —');
eq(componerDesglose(EPIC, false),
   'Cuadro y estructura: 7/7\nSuspensiones: 6.5/7\nFrenos y transmisión: 6.8/7\nElectrónica: 7/7',
   'muscular: notas enteras sin decimal, en el orden canónico');
const ELEC = { nota_cuadro: 7, nota_motor_bateria: 6.7, nota_suspensiones: 6.5, nota_frenos_transmision: 6.8, nota_ruedas_componentes: 6.9 };
const dElec = componerDesglose(ELEC, true).split('\n');
eq(dElec[1], 'Motor y batería: 6.7/7', 'eléctrica: motor y batería va SEGUNDO (entra en las 4 barras de la tarjeta)');
eq(dElec.length, 5, 'solo las áreas con nota');
eq(componerDesglose({}, false), null, 'sin notas → null, no un string vacío');

console.log('\n— 3. Specs: los upgrades conservan su encabezado —');
eq(componerSpecs(EPIC),
   '# Upgrades incluidos\nRuedas: Roval Control SL carbono\nTija: SRAM Reverb AXS (electrónica)\n' +
   '# Componentes\nSuspensión: sistema Brain inteligente\nCuadro: Carbono FACT 11m',
   'upgrades primero, cada bloque con su título');
eq(componerSpecs({ componentes: '- Frenos: SRAM\n\n• Ruedas: Roval' }),
   '# Componentes\nFrenos: SRAM\nRuedas: Roval', 'tolera viñetas y líneas vacías del copy-paste');

console.log('\n— 4. Ida y vuelta contra los parsers reales —');
const specs = parseSpecs(componerSpecs(EPIC));
eq(specs.length, 2, 'build.mjs lee dos grupos');
eq(specs[0].grupo, 'Upgrades incluidos', 'el grupo de upgrades sobrevive a parseSpecs');
eq(specs[0].filas[0][0], 'Ruedas', 'etiqueta de la fila');
eq(specs[0].filas[0][1], 'Roval Control SL carbono', 'valor de la fila');
const rango = parseRangoAltura(componerRangoAltura(EPIC));
ok(rango && Math.abs(rango[0] - 1.78) < 1e-9 && Math.abs(rango[1] - 1.88) < 1e-9,
   'mc-match lee el rango de altura como 1,78–1,88 m', JSON.stringify(rango));
const fila = desgloseRow(componerDesglose(EPIC, false).split('\n')[1].split(/:(.*)/).map(s => s.trim()));
eq(fila.pct, 93, 'build.mjs calcula 6.5/7 = 93 % para la barra');

console.log('\n— 5. Salud de batería: el campo percent guarda la fracción —');
const e = mapearAiloo({ referencia: '1', motorizacion: 'electrica', salud_bateria_pct: 92, km_motor: 1250, ciclos_carga: 87 });
eq(e.fields['Diag · salud batería'], 0.92, '92 se guarda como 0,92 (build lo multiplica por 100)');
eq(e.fields['Diag · km motor'], 1250, 'km del motor');
const mus = mapearAiloo({ referencia: '1', motorizacion: 'muscular', salud_bateria_pct: 92 });
eq(mus.fields['Diag · salud batería'], undefined, 'diagnóstico en una muscular se ignora');
ok(mus.avisos.some(a => a.includes('diagnóstico')), 'y se avisa en la respuesta');
ok(mapearAiloo({ referencia: '1', puntaje: 9 }).avisos.some(a => a.includes('escala')), 'puntaje 9 se rechaza con aviso');
ok(mapearAiloo({ referencia: '1', disciplina: 'gravel' }).avisos.some(a => a.includes('disciplina')), 'disciplina desconocida se avisa');

console.log('\n— 6. Estado según stock (sin pisar lo que decide el equipo) —');
eq(estadoSegunStock(0, 'Disponible'), 'Vendida', 'stock 0 → Vendida');
eq(estadoSegunStock(0, 'Vendida'), null, 'ya vendida → no se toca');
eq(estadoSegunStock(1, 'Vendida'), 'Disponible', 'volvió a haber stock → Disponible');
eq(estadoSegunStock(1, 'Reservada'), null, 'NUNCA pisa una Reservada (hay una seña de por medio)');
eq(estadoSegunStock(1, 'Disponible'), null, 'ya disponible → no se toca');
eq(estadoSegunStock(1, 'Borrador'), 'Disponible', 'un borrador con stock se publica');
eq(estadoSegunStock(null, 'Disponible'), null, 'sin stock en el envío → no se toca el estado');

console.log('\n— 7. Contrato de respuestas —');
const post = (body, { key, env = {}, qs = '' } = {}) => onRequestPost({
  request: new Request(`https://x/api/ailoo-bici${qs}`, {
    method: 'POST',
    headers: key ? { 'X-API-Key': key } : {},
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }),
  env,
});

let r = await post(EPIC, { qs: '?dry=1' });
let j = await r.json();
eq(r.status, 200, 'dry=1 responde 200');
ok(j.dry === true && j.accion === 'simulada', 'dry=1 se identifica como simulación');
eq(j.campos_airtable['Rango altura'], '178 a 188 cm', 'dry=1 muestra los campos ya compuestos');
ok(String(j.estado_calculado).includes('Disponible'), 'dry=1 explica el estado que resultaría');
eq(j.aviso_seguridad, 'sin_clave_configurada', 'sin AILOO_KEY lo dice en la respuesta');

r = await post({ modelo: 'sin referencia' }, { qs: '?dry=1' });
j = await r.json();
eq(r.status, 400, 'sin referencia → 400');
eq(j.error, 'falta_referencia', 'código de error del contrato');

r = await post('{roto', { qs: '?dry=1' });
eq((await r.json()).error, 'json_invalido', 'JSON roto → json_invalido');

r = await post(EPIC, { env: { AILOO_KEY: 'secreta' }, key: 'otra', qs: '?dry=1' });
eq(r.status, 401, 'clave equivocada → 401');
eq((await r.json()).error, 'clave_invalida', 'código de error del contrato');

r = await post(EPIC, { env: { AILOO_KEY: 'secreta' }, key: 'secreta', qs: '?dry=1' });
eq(r.status, 200, 'clave correcta por cabecera X-API-Key → 200');

r = await onRequestGet({ env: {} });
j = await r.json();
ok(j.ok && j.metodo === 'POST', 'GET devuelve la ficha del endpoint');
ok(String(j.autenticacion).includes('SIN CLAVE'), 'GET grita si no hay clave configurada');

console.log(fallos === 0 ? '\n✅ Todo verde\n' : `\n❌ ${fallos} fallo(s)\n`);
process.exit(fallos === 0 ? 0 : 1);
