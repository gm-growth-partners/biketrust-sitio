// Worker cron · dispara el motor de recordatorios del embudo.
// El único trabajo del Worker es pegarle al endpoint del sitio Pages en cada
// tick del Cron Trigger (ver wrangler.toml). Toda la lógica vive en el endpoint
// (functions/api/cron-recordatorios.js) para no duplicar credenciales ni código.
export default {
  async scheduled(event, env, ctx) {
    const u = `${env.CRON_URL}?key=${encodeURIComponent(env.CRON_KEY || '')}`;
    try {
      const r = await fetch(u, { method: 'GET', headers: { 'User-Agent': 'biketrust-cron' } });
      const body = await r.text();
      console.log(`[recordatorios] ${r.status} ${body.slice(0, 800)}`);
    } catch (e) {
      console.log(`[recordatorios] fetch_error ${String(e)}`);
    }
  },
};
