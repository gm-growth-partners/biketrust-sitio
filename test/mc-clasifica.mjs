// Test offline del enrutador de la puerta DM (capa de reglas de mc-clasifica).
// Corre con: node test/mc-clasifica.mjs
// Cubre los mensajes del protocolo E2E + los casos reales de la conversación
// de Joshua G. + los ejemplos del contexto del diseño (runbook §5.2).

import { clasificar } from '../functions/api/mc-clasifica.js';

const CASOS = [
  // — protocolo E2E (doc de construcción DM) —
  ['tienen la levo sl?', 'MODELO', 'Levo SL'],
  ['cuánto vale?', 'BICI_SUELTA', ''],
  ['busco una para el cerro, ando en 4 palos, mido 1.75', 'ASESORIA', ''],
  ['vendo mi bici', 'VENDER', ''],
  ['dónde están?', 'VISITA', ''],
  ['+56 9 1234 5678', 'CONTACTO', ''],
  ['qué garantía tienen?', 'GARANTIA', ''],
  ['gracias! y esos neumáticos sirven para tubeless?', 'TECNICA', ''],
  ['muchas gracias, lo voy a pensar', 'CIERRE', ''],
  ['asdfghjkl', 'NO_CLASIFICA', ''],
  // — el mensaje que mató al AI Step —
  ['Hola quiero vender una bici', 'VENDER', ''],
  // — ejemplos del contexto del diseño —
  ['busco una Epic', 'MODELO', 'Epic'],
  ['Levo sl swork', 'MODELO', 'Levo SL'],
  ['cuánto vale la Levo?', 'MODELO', 'Levo'],
  ['la Creo sigue disponible?', 'MODELO', 'Creo'],
  ['se vendió?', 'BICI_SUELTA', ''],
  ['la tienen en talla M?', 'BICI_SUELTA', ''],
  ['la del video la tienen?', 'BICI_SUELTA', ''],
  ['qué me recomiendas', 'ASESORIA', ''],
  ['mido 1,70 cuál me sirve', 'ASESORIA', ''],
  ['reciben la mía?', 'VENDER', ''],
  ['cuánto me dan por la mía si compro esa?', 'VENDER', ''],
  ['despachan a Concepción?', 'ENVIOS', ''],
  ['y si se echa a perder?', 'GARANTIA', ''],
  ['se puede en cuotas?', 'PAGOS', ''],
  ['qué grupo trae?', 'TECNICA', ''],
  ['cuánto pesa?', 'TECNICA', ''],
  ['a qué hora abren?', 'VISITA', ''],
  ['puedo ir a verlas?', 'VISITA', ''],
  ['mejor llámenme', 'CONTACTO', ''],
  ['llámame al 9 1234 5678', 'CONTACTO', ''],
  ['hola', 'SALUDO', ''],
  ['hola, una consulta', 'SALUDO', ''],
  ['estás?', 'SALUDO', ''],
  ['🔥', 'SALUDO', ''],
  // — casos Joshua (los que motivaron TECNICA y CIERRE) —
  ['estoy barajando opciones', 'CIERRE', ''],
  ['de momento no, estoy viendo la platita', 'CIERRE', ''],
  ['después te escribo', 'CIERRE', ''],
  // — precedencias del diseño —
  ['gracias, mejor llámenme', 'CONTACTO', ''],          // CONTACTO gana a CIERRE
  ['la levo tiene mantención hecha?', 'TECNICA', 'Levo'], // técnica con modelo, sin precio
  ['quenevo', 'MODELO', 'Kenevo'],
];

let ok = 0, fail = 0;
for (const [msg, esperadaInt, esperadoMod] of CASOS) {
  const r = clasificar(msg);
  const pasaInt = r.intencion === esperadaInt;
  const pasaMod = esperadoMod === undefined || r.modelo === esperadoMod;
  if (pasaInt && pasaMod) { ok++; continue; }
  fail++;
  console.log(`✗ «${msg}»`);
  console.log(`    esperado: ${esperadaInt}${esperadoMod ? ' · ' + esperadoMod : ''}`);
  console.log(`    obtenido: ${r.intencion}${r.modelo ? ' · ' + r.modelo : ''}`);
}
console.log(`\n${ok}/${CASOS.length} OK${fail ? ` · ${fail} FALLAN` : ' — enrutador listo'}`);
process.exit(fail ? 1 : 0);
