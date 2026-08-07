// Worker cron · dispara los motores del embudo en cada tick del Cron Trigger.
// El Worker sólo le pega a los endpoints del sitio Pages; toda la lógica vive
// ahí (functions/api/cron-*.js) para no duplicar credenciales ni código.
//   - cron-recordatorios: recordatorios 48h / 8am (decide la ventana en el server).
//   - cron-briefing: briefing diario a Luis (sólo envía a las 08:0x de Chile).
//   - cron-sourcing: avisa a Roberto y Alfonso los encargos que pasaron a Buscando.
// Todos son idempotentes y seguros de re-llamar cada 15 min.
export default {
  async scheduled(event, env, ctx) {
    if (!env.CRON_URL) { console.log('[cron] falta CRON_URL'); return; }
    const key = encodeURIComponent(env.CRON_KEY || '');
    const u = (nombre) => env.CRON_URL.replace('cron-recordatorios', nombre);

    // ⚠️ EL ORDEN IMPORTA, aunque no es de lo que depende la corrección.
    //
    // `cron-briefing` va PRIMERO por dos razones. La primera: su ventana es de un
    // solo tick al día (9:00–9:14), así que si va detrás de un cron pesado que se
    // cuelga, se pierde el briefing entero de ese día en silencio. La segunda: a
    // las 9:00 el briefing lista y SELLA toda la cola acumulada de la noche, y así
    // `cron-avisos` —que corre después— ya no encuentra nada que mandar.
    //
    // Pero la exclusión NO depende de este orden: `cron-avisos` arranca con
    // `if (esTickBriefing()) return`. Si alguien reordena este array, o si algún
    // día esto se paraleliza, esa línea sigue valiendo. El orden es una
    // optimización, no la garantía.
    const CRONES = [
      ['briefing', u('cron-briefing')],
      ['recordatorios', env.CRON_URL],
      ['reenganche', u('cron-reenganche')],
      ['sourcing', u('cron-sourcing')],
      ['avisos', u('cron-avisos')],
    ];

    for (const [name, url] of CRONES) {
      try {
        // Timeout por endpoint: sin esto, uno colgado se come el presupuesto de
        // la invocación y los que van detrás no llegan a correr.
        const r = await fetch(`${url}?key=${key}`, {
          method: 'GET',
          headers: { 'User-Agent': 'biketrust-cron' },
          signal: AbortSignal.timeout(60000),
        });
        const body = await r.text();
        console.log(`[${name}] ${r.status} ${body.slice(0, 600)}`);
      } catch (e) {
        console.log(`[${name}] fetch_error ${String(e)}`);
      }
    }
  },
};
