# worker-cron · disparador del motor de recordatorios

Cloudflare Pages Functions **no** soporta triggers cron. Este Worker mínimo cubre
ese hueco: en cada tick de su Cron Trigger le pega al endpoint
`/api/cron-recordatorios` del sitio Pages, que hace todo el trabajo (barrer Airtable
y disparar las plantillas de WhatsApp vía ManyChat).

## Qué hace

- Corre cada **15 minutos** (`*/15 * * * *`, en `wrangler.toml`).
- Hace `GET https://biketrust-sitio.pages.dev/api/cron-recordatorios?key=CRON_KEY`.
- Loguea el resultado (visible en `wrangler tail` o en el dashboard del Worker).

No tiene tokens de Airtable ni de ManyChat: esos viven en las env del proyecto
**Pages**, no acá. Este Worker solo conoce la URL + `CRON_KEY`.

## Desplegar (una sola vez)

Requisitos previos: haber seteado en el proyecto **Pages** las envs
`CRON_KEY`, `MANYCHAT_TOKEN`, `FLOW_NS_48H`, `FLOW_NS_2H` (ver EMBUDO.md §8).

```bash
cd worker-cron
npx wrangler login          # si no hay sesión
npx wrangler deploy
npx wrangler secret put CRON_KEY   # pegar el MISMO valor que la env CRON_KEY de Pages
```

Listo: el motor queda corriendo cada 15 min. Para ver la salida en vivo:

```bash
npx wrangler tail
```

## Notas

- Si cambia la URL del sitio (dominio propio `biketrust.cl`), actualizar `CRON_URL`
  en `wrangler.toml` y re-desplegar.
- Pausar el motor = borrar el Cron Trigger en el dashboard, o `npx wrangler delete`.
- El endpoint es idempotente y seguro de re-llamar: no re-envía recordatorios ya
  enviados (se estampa `Recordatorio 48h/2h` en el Lead).
