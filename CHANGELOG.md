# Bike Trust · Historial del sistema

> **Para quien lee esto en frío (humano o Claude):** este archivo cuenta *qué pasó y por qué*,
> en orden. Si vienes llegando, léelo antes que cualquier otra cosa: explica por qué el
> sistema está como está y qué decisiones ya se tomaron (para no volver a discutirlas).
>
> El estado **actual** vive en [`CLAUDE.md`](CLAUDE.md). Este archivo es la memoria histórica.

---

## V2 · El embudo que apunta a la llamada — EN CONSTRUCCIÓN (desde 2026-07-27)

### 2026-07-27 · El pivote
**Qué cambió:** el objetivo del bot deja de ser la visita y pasa a ser **el teléfono**. El bot
entrega valor (ficha con puntaje, estado honesto y ahorro), pide el número, y **la visita la
cierra Luis por teléfono**.

**Por qué:** la semana 30 fue la primera con tráfico real y el resultado fue **31 leads, 27
fichas entregadas y CERO visitas agendadas**. La evidencia externa explica por qué: un flujo
tipo formulario convierte ~1,7 %, una llamada ~37 %; en vehículos usados el 78 % de los leads
telefónicos agenda cita contra el 44 % de los digitales. El cuello no era el copy: era que
nadie pasaba a voz.

**Decisiones tomadas (no re-discutir):**
- **Sin menú de bienvenida.** El bot reconoce la intención del texto libre y rutea. La IA de
  intención de ManyChat está confirmada disponible.
- **Sin pregunta de ubicación en el bot.** Es irrelevante si igual va a hablar con el
  especialista; Luis pregunta la comuna en la llamada, que da mejor dato.
- **10 palabras clave por reel** (NO any-word). Se asume perder la cola larga a cambio de que
  el filtro deje pasar solo intención declarada.
- **El permiso de WhatsApp lo marca Luis en la llamada**, no el bot. El teléfono se pidió para
  una llamada; usarlo para mensajes sin permiso explícito es consentimiento de canal A en canal B.
- **El bot no retoma dentro de las 24 h** cuando pasó a modo humano, aunque entienda la
  intención: no se pisa una conversación de Luis en curso.
- **Meta del dueño: 20–30 % de los leads entregan teléfono** (semana 30 = 3 %).
  **La semana 30 es la base de comparación.**

**Aprobado por:** Roberto (reunión 2026-07-27). Alfonso informado.

### 2026-07-27 · La operación de Luis: un Kanban, un gesto
Luis trabaja en **una sola pantalla**: arrastrar la tarjeta *es* marcar la salida *es*
disparar el mensaje automático. Cinco salidas desde una cola única.
Diseño: [`docs/V2_OPERACION_KANBAN.md`](docs/V2_OPERACION_KANBAN.md).

### 2026-07-27 · Construido
- `mc-evento` devuelve la bici en **campos planos** (puntaje, área más baja, estado honesto,
  precio/ahorro, rango altura, batería, disponible) — sin esto el DM no puede pintar la ficha.
- `mc-llamado` sella **`Fecha teléfono`** en el Lead (la métrica #1) y **deduplica** tickets
  abiertos del mismo lead.
- **`salida-llamado`** (nuevo): el motor de post-llamada. Propaga el permiso del ticket al
  Lead, copia la visita agendada por teléfono, dispara la plantilla que corresponde, con sello
  de idempotencia. 17/17 en pruebas.
- **`cron-sourcing`** (nuevo): avisa a Roberto y Alfonso los encargos que pasan a `Buscando`.
  Es un barrido del cron existente, **no una automatización de Airtable** (esas se pagan).
- Tablero: etapa **«Dejó teléfono»** en el embudo, y las conversiones separadas
  «Ficha → Teléfono» (mide al bot) y «Teléfono → Agenda» (mide la llamada).
- **`mc-match` modo A**: matching por bigramas. Caso real corregido: «Levo sl swork» daba
  no-match teniendo la bici disponible.

### 2026-07-27 · Datos
- **Limpieza:** 17 registros de prueba eliminados. La base quedó 100 % real.
- **Atribución de reels al 100 %:** los 13 Intereses huérfanos se recuperaron leyendo los
  comentarios públicos de cada post en Instagram. **Esa es la única fuente retroactiva** — ni
  Airtable ni el export de IG guardan de qué post vino un comentario.
- 6 reels registrados en `Reels`. El `Post ID` es el **shortcode** de la URL.

---

## V1 · El sistema que capta y agenda — EN VIVO (jun–jul 2026)

### 2026-07-20 · Ailoo pasa a ser el ERP central
El embudo se corta en **show/no-show**; la venta la registrará Ailoo vía integración futura
(contacto: «Gina»). Trazabilidad por teléfono del comprador + código único por unidad (SWSS).
`registrar-venta` queda como **fallback transitorio**, no como camino principal.

### 2026-07-17 · Tablero de reporte (Anexo A3)
App web privada **separada** (repo `biketrust-tablero`): 19 métricas calculadas en build time
desde esta base, gate server-side con cookie HMAC. Solo lectura.

### 2026-07-10 · Lanzamiento
El embudo completo sale a producción: Puerta 1 (comentario → ficha), Puerta 2 (DM → router,
quiz, encargos, consignación), región, WhatsApp con confirmación y recordatorios, avisos al
staff. **La semana 30 (20–26 jul) es la primera con tráfico real.**

### 2026-07-09 · Candado y sourcing
`MC_KEY` activa en los 7 puentes. Tablas `Solicitudes` y `Llamados` operativas. Briefing
diario al staff en vivo.

### 2026-07-01 al 07-08 · El embudo
`mc-lead` · `mc-evento` · `mc-agenda` · `mc-match` · `mc-consigna` · `mc-waitlist` ·
`mc-llamado`. **Rediseño del 07-01:** el embudo se automatiza de punta a punta hasta el
showroom; el humano solo cierra en tienda. *(Esta decisión fue parcialmente revertida el
2026-07-27: el humano vuelve al embudo, pero en la llamada, no en el chat — ver V2.)*

### 2026-06-21 · Sitio en vivo
Sitio estático generado desde Airtable a Cloudflare Pages. Catálogo, fichas, reservas.

---

## Decisiones revertidas (y por qué)

| Decisión original | Qué la revirtió |
|---|---|
| «El humano solo cierra en tienda; el embudo es 100 % automático» (07-01) | La semana 30: 27 fichas → 0 agendas. El humano vuelve, pero en la llamada. |
| «Menú de 3 botones en el DM» (07-07) | 5 DMs libres quedaron varados sin ruta. Se reemplaza por reconocimiento de intención. |
| «¿Estás en Santiago?» como filtro del bot | Es irrelevante si igual va a hablar con el especialista, y convierte peor que una invitación. |
| «Registrar la venta en Airtable» como camino principal | Decisión Ailoo (07-20): la venta la registra el ERP. |

### 2026-07-27 · Auditoría de lectura en frío
Tres lectores independientes leyeron los repos **sin contexto previo** para verificar que se
entienden solos. Encontraron **tres bugs reales**, ya corregidos:

1. **`MC_TOKEN` vs `MANYCHAT_TOKEN`** — `salida-llamado` y `cron-sourcing` leían una variable
   de entorno que **no existe en Cloudflare**; las otras 8 funciones usan `MANYCHAT_TOKEN`.
   Habrían reportado «no configurado» para siempre, en silencio.
2. **`No contestó` vs `No contestado`** — el código hace match exacto contra el nombre de la
   opción del select. Los documentos usaban una grafía y el código otra: al arrastrar la
   tarjeta no habría disparado nada. **Unificado en `No contestado`.**
3. **`salida-llamado` no sincronizaba `Estado`** aunque el diseño lo prometía. Sin eso, el
   sello de `Fecha primera llamada` (la métrica de velocidad) nunca se disparaba.

También: el README no guiaba (mandaba a la documentación en retiro antes que al CHANGELOG),
las rutas locales estaban mal, había una referencia a un archivo inexistente, y `CLAUDE.md`
tenía **dos «FOCO ACTUAL» contradictorios**. Todo corregido.

**Los tests ahora viven en el repo** (`test/`, `npm test`): antes el CHANGELOG citaba «17/17»
y los scripts no estaban versionados, así que nadie podía re-correrlos. Son 23 aserciones que
corren sin tocar Airtable ni producción.

## Erratas de documentación corregidas

- El API de Airtable **sí crea lookups y campos de fórmula** (`CLAUDE.md` §5.2 decía que no).
  Lo que **no** puede es agregar opciones a un select existente ni borrar campos.
- Publicar un reel **NO reabre** la ventana de 24 h de Instagram. Solo la reabre un mensaje
  de la persona. (Se había asumido lo contrario al planificar el reenganche.)
