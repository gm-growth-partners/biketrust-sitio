// Verificación E2E del embudo V2 contra la base REAL (lectura, no escribe nada).
// Uso:  node test/verificar-e2e.mjs <handle-de-instagram-sin-@>
//
// Corre los chequeos del §8 del runbook después del comentario de prueba:
//   Lead (canal, subscriber id, Fecha teléfono) · Interés (Reel ✓, Bici ✓)
//   · ticket en Llamados (Estado, Origen, brief poblado).
// Lee AIRTABLE_PAT de .dev.vars (gitignored). No usa MC_KEY: va directo a Airtable.
import { readFileSync } from 'node:fs';

const handle = String(process.argv[2] || '').replace(/^@/, '').trim();
if (!handle) { console.error('Uso: node test/verificar-e2e.mjs <handle-sin-@>'); process.exit(1); }

const PAT = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf-8')
  .split(/\r?\n/).find(l => l.startsWith('AIRTABLE_PAT='))?.split('=').slice(1).join('=').trim();
if (!PAT) { console.error('No encontré AIRTABLE_PAT en .dev.vars'); process.exit(1); }

const BASE = 'appQUgk8aeD752923';
const H = { Authorization: `Bearer ${PAT}` };
const api = (t, q = '') => `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(t)}${q}`;
const get = async (u) => { const r = await fetch(u, { headers: H }); if (!r.ok) throw new Error(`${r.status} ${await r.text()}`); return r.json(); };

let fallas = 0;
const check = (ok, msg, extra = '') =>
  console.log(`${ok ? '✅' : '❌'} ${msg}${ok || !extra ? '' : `  → ${extra}`}`) || (ok || fallas++);

// 1 · El Lead
const lf = `LOWER({@handle IG})='${handle.toLowerCase().replace(/'/g, "\\'")}'`;
const leads = (await get(api('Leads', `?filterByFormula=${encodeURIComponent(lf)}`))).records;
check(leads.length === 1, `Lead único para @${handle}`, `encontrados: ${leads.length}`);
if (!leads.length) process.exit(1);
const lead = leads[0], L = lead.fields;
check(L['Canal origen'] === 'Comentario IG', `Canal origen = Comentario IG`, `es: ${L['Canal origen']}`);
check(!!L['MC subscriber id'], 'MC subscriber id capturado');
check(!!L['Fecha teléfono'], 'Fecha teléfono SELLADA (métrica #1)', 'vacía — ¿llegó hasta B5/Correcto?');
check(!!L['WhatsApp'], 'WhatsApp guardado en el Lead');

// 2 · El Interés con atribución
const intIds = L['Intereses'] || [];
check(intIds.length >= 1, `Interés creado (${intIds.length})`);
for (const id of intIds) {
  const f = (await get(api('Intereses') + '/' + id)).fields;
  const reel = (f['Reel'] || []).length > 0, bici = (f['Bici'] || []).length > 0;
  check(reel, `Interés #${f['Interés ID']}: tiene Reel (atribución al video)`, 'SIN REEL — el body de mc-evento no mandó el shortcode');
  check(bici, `Interés #${f['Interés ID']}: tiene Bici`, 'sin bici — ¿reel sin fila en Reels, o fila sin Bici?');
  console.log(`   · Origen: ${f['Origen'] || '—'} · Resultado: ${f['Resultado'] || '—'} · Fecha: ${f['Fecha'] || '—'}`);
}

// 3 · El ticket en Llamados
const llamIds = L['Llamados'] || [];
check(llamIds.length >= 1, `Ticket en Llamados (${llamIds.length})`, 'no hay — ¿mc-llamado corrió?');
for (const id of llamIds) {
  const f = (await get(api('Llamados') + '/' + id)).fields;
  check(f['Estado'] === 'Llamada pendiente', `Ticket: Estado = Llamada pendiente`, `es: ${f['Estado']}`);
  check(f['Origen'] === 'Bot DM', `Ticket: Origen = Bot DM`, `es: ${f['Origen']}`);
  check(!!f['Teléfono'], 'Ticket: teléfono anotado');
  check(f['Salida'] === 'Llamada pendiente', 'Ticket: Salida = Llamada pendiente (automatización de columna)', `es: ${f['Salida'] || 'VACÍA — ¿encendiste la automatización?'}`);
  const brief = ['Puntaje', 'Rango altura bici', 'Precio bici', 'Estado bici'].filter(k => (f[k] || []).length);
  check(brief.length === 4, `Ticket: brief poblado (${brief.length}/4 lookups)`, 'faltan — ¿el ticket quedó sin Bici de interés?');
  if (f['Notas']) console.log(`   · Notas: ${String(f['Notas']).slice(0, 100)}`);
}

console.log(fallas ? `\n⛔ ${fallas} chequeo(s) fallaron` : '\n🎉 E2E completo: el viaje quedó bien escrito de punta a punta');
console.log('Recuerda BORRAR los registros de prueba por id (Lead, Intereses, Llamado).');
process.exit(fallas ? 1 : 0);
