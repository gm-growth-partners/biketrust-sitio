// Worker cron · dispara los motores del embudo en cada tick del Cron Trigger.
// El Worker sólo le pega a los endpoints del sitio Pages; toda la lógica vive
// ahí (functions/api/cron-*.js) para no duplicar credenciales ni código.
//   - cron-recordatorios: recordatorios 48h / 8am (decide la ventana en el server).
//   - cron-briefing: briefing diario a Luis (sólo envía a las 08:0x de Chile).
// Ambos son idempotentes y seguros de re-llamar cada 15 min.
export default {
  async scheduled(event, env, ctx) {
    const key = encodeURIComponent(env.CRON_KEY || '');
    const recUrl = env.CRON_URL;                                          // .../api/cron-recordatorios
    const briefUrl = env.CRON_URL.replace('cron-recordatorios', 'cron-briefing');
    const reengUrl = env.CRON_URL.replace('cron-recordatorios', 'cron-reenganche');
    for (const [name, url] of [['recordatorios', recUrl], ['briefing', briefUrl], ['reenganche', reengUrl]]) {
      try {
        const r = await fetch(`${url}?key=${key}`, { method: 'GET', headers: { 'User-Agent': 'biketrust-cron' } });
        const body = await r.text();
        console.log(`[${name}] ${r.status} ${body.slice(0, 600)}`);
      } catch (e) {
        console.log(`[${name}] fetch_error ${String(e)}`);
      }
    }
  },
};
