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

    // ── Panel de Contenido (repo del tablero, otro dominio) ──
    // Estos NO van cada 15 min. El snapshot corre UNA vez al día porque su trabajo es
    // fotografiar el acumulado del día, y el refresco del token una vez por semana
    // porque el token dura 60 días. La ventana se decide acá, en hora de Santiago,
    // para que el horario de verano no la corra sola.
    if (env.TABLERO_URL) {
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago",
        hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false })
        .formatToParts(new Date()).map((x) => [x.type, x.value]));
      const hora = Number(p.hour), minuto = Number(p.minute);
      // 03:00–03:14 de Chile: un solo tick al día.
      if (hora === 3 && minuto < 15) CRONES.push(["ig-sync", env.TABLERO_URL + "/api/ig-sync", env.TABLERO_KEY]);
      // Lunes 03:15–03:29: el refresco semanal, después del snapshot.
      if (p.weekday === "Mon" && hora === 3 && minuto >= 15 && minuto < 30) {
        CRONES.push(["ig-token", env.TABLERO_URL + "/api/ig-token-refresh", env.TABLERO_KEY]);
      }
    }

    for (const [name, url, claveAparte] of CRONES) {
      try {
        // Timeout por endpoint: sin esto, uno colgado se come el presupuesto de
        // la invocación y los que van detrás no llegan a correr.
        const r = await fetch(`${url}?key=${claveAparte ? encodeURIComponent(claveAparte) : key}`, {
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
