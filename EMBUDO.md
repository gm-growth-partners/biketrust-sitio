# Bike Trust · El Embudo (Instagram + ManyChat → Airtable)

> Documento maestro del **embudo de captación automatizado**: cómo un comentario o
> DM de Instagram se convierte en una visita agendada al showroom, medida de punta
> a punta en Airtable. Pensado para **ejecutar directo** y para que **una persona
> nueva entienda el sistema completo leyéndolo**.
>
> Complementa a [`DOCUMENTACION.md`](DOCUMENTACION.md) (web + CRM + reportes) y a
> [`CLAUDE.md`](CLAUDE.md) (notas técnicas finas y gotchas). Idioma: español.
> Última actualización: **2026-07-03**.

**Leyenda de estado:** ✅ en vivo y verificado · 🔧 por construir · ⏸️ bloqueado por dependencia externa · 💡 diseñado, en fila.

---

## 0. Estado en una mirada

| # | Pieza | Estado |
|---|---|---|
| 1 | **Puerta 1 — comentario en reel** → ficha + calificación | ✅ En vivo |
| 2 | **Agendamiento en el chat** (selector de horario → Airtable) | ✅ En vivo y probado con usuario real |
| 3 | **Cierre en tienda** (staff marca vino/compró en la Agenda) | ✅ En vivo |
| 4 | **Confirmación + recordatorios por WhatsApp** (Fase 3) | ✅ En vivo y autónomo: confirmación (al agendar) + recordatorio 48h + recordatorio 8am del día. Motor cron cada 15 min. |
| 5 | **Briefing diario al staff** (visitas del día) | 🔧 Por construir (próxima pieza) |
| 6 | **Puerta 2 — router del DM + quiz + waitlist** | 💡 Diseñado, en fila |

**Qué falta para "sistema base terminado":** solo #5 (briefing diario a Luis). El #4 (WhatsApp) quedó **en vivo y automático** (2026-07-07). Después se abre la expansión #6.

**Pendientes finos del #4:** (a) registrar el estado `visita_confirmada` — la plantilla enviada NO trae botón "Sí, confirmo", así que hoy la confirmación es informativa (no se trackea quién confirma); si se quiere trackear, hay que agregar el botón a la plantilla (re-aprobación Meta) + cablearlo a `mc-evento`. (b) El recordatorio de "2h antes" quedó fuera por simplicidad (se puede sumar con una variable de entorno si se decide).

---

## 1. El principio rector

> **Instagram captura · WhatsApp automatiza el resto · el humano solo cierra en la tienda.**

El embudo se automatiza de punta a punta **hasta el showroom**. La única intervención humana es el **cierre presencial** (probar la bici + negociar precio). Todo lo demás —entregar ficha, calificar, agendar, confirmar, recordar, reenganchar— lo hace el bot.

Por qué WhatsApp para el tramo con retraso: Instagram **no permite mensajes automáticos fuera de la ventana de 24h**. Los mensajes que van con demora (confirmación, recordatorio 48h/2h, reenganche) van por **plantillas de WhatsApp**, que no tienen ese límite (98% de apertura, reducen el no-show 50-80%). El **pivote** es capturar teléfono + opt-in de WhatsApp al momento de agendar (ya implementado).

La psicología de venta se conserva pero la entrega el bot: **escasez real** ("única en talla M"), **horario A/B** ("sábado AM o viernes PM") y **"te la reservo"**.

---

## 2. Las puertas de entrada (mapa)

| Puerta | Qué es | Rutea a | Estado |
|---|---|---|---|
| **1 · Comentario en reel/post** | Modelo conocido: el reel es de una bici específica | Ficha de esa bici → agenda | ✅ |
| **2 · DM directo** | Router con 3 botones (ver §10) | Ficha / Quiz / Waitlist | 💡 |
| **3 · Respuesta a historia** | Cae en el **mismo** router del DM | igual que Puerta 2 | 💡 |
| **4 · Link en bio → sitio web** | Reserva desde la ficha web | Reserva (`reservar.js`) | ✅ (canal web) |
| **5 · Ads click-to-DM / menciones** | Si algún día pautan | flujo específico por `ref` | 💡 futuro |

La bici de la Puerta 1 se resuelve **por dato, no por flujo**: el reel comentado se identifica con su Post ID, que la tabla **`Reels`** mapea a una bici (`Reels.Bici`). Ver §6.

---

## 3. El recorrido de extremo a extremo

| # | Etapa | Canal | Auto | Escribe en Airtable | Estado |
|---|---|---|---|---|---|
| 1 | **Captura** — comenta reel (P1) o DM/quiz (P2) | Instagram | 🤖 | `mc-lead` → Lead (canal, Fecha 1er contacto) | ✅ (P1) |
| 2 | **Ficha + califica** — entrega ficha + preguntas | IG DM | 🤖 | `mc-evento` → Estado + Interés | ✅ |
| 3 | **Puente** — pide teléfono + opt-in WhatsApp | IG DM | 🤖 | Lead: `WhatsApp`, `Opt-in WhatsApp` | ✅ |
| 4 | **Agenda en el chat** — elige horario A/B | IG DM | 🤖 | `mc-agenda` → `Fecha visita` + `visita_agendada` + Interés "Agendó" | ✅ |
| 5 | **Confirma + recuerda** — confirmación (al agendar) + recordatorios 48h/8am | WhatsApp | 🤖 | `cron-recordatorios` dispara plantillas; `Recordatorio 48h/8am` en el Lead | ✅ (registro de `visita_confirmada` pendiente: falta botón "Sí confirmo" en la plantilla) |
| 6 | **Showroom — el cierre** — prueba + precio | Presencial | 🧑 | `registrar-venta` → `cerró` + `Vendida` | ✅ |
| 7 | **Post-visita / reenganche** — no-show, suelto, "volvió a stock" | WhatsApp + IG | 🤖 | Estado, reactivación | 🔧 |

**Máquina de estados del Lead (13 estados, con rango para la guarda de no-regresión):**

```
nuevo(0)
 → ficha_entregada(1) / quiz_iniciado(1)
 → quiz_abandonado(2) / match_entregado(2) / no_match(2)
 → visita_agendada(3)
 → visita_confirmada(4)
 → no_show(5) / visitó(5)
 → cerró(6)
terminales: muerto(99), descartado(99)
```

El rango evita que un webhook repetido o fuera de orden **retroceda** un lead ya avanzado: un estado con rango menor al actual **no se aplica** (solo se registra el Interés/interacción).

---

## 4. El flujo en ManyChat (cómo está armado)

Automatización **`Embudo Bike Trust v2`** (la v1 quedó descartada). Requiere ManyChat **Pro** + Meta Business (para "Solicitud externa" / External Request).

### 4.1 Estructura de bloques (Puerta 1)

1. **Disparador** — Instagram → Comentario en el reel (post específico), cualquier palabra. "Enviar primer mensaje como respuesta privada" activo.
2. **Solicitud externa → `mc-lead`** (POST).
3. **Solicitud externa → `mc-evento`** (POST, con `reel` = Post ID).
4. **Mensaje 1 (respuesta privada, terminal)** — texto + **botón de FLUJO** `👀 Sí, muéstramela` (NO "Abrir URL"). Este toque es el que abre el hilo.
5. **Mensaje 2 — la ficha** — texto + botón **URL** `Abrir ficha` → `/ficha/<slug>`.
6. **Pausa inteligente 30s** — para que lea la ficha antes de la siguiente pregunta.
7. **Mensaje 3 — ¿agendar?** — texto + botón de FLUJO `📅 Agendar mi visita`.
8. **Captura de teléfono** — paso "Pregunta" tipo **Teléfono**, con **"Guardar como ID de WhatsApp" = ON** (clave para Fase 3) + guardar en campo personalizado `cf_telefono`.
9. **Mensaje 4 — horario** — 2 botones: `Sábado en la mañana` → Solicitud externa `mc-agenda` con `slot:"A"` · `Viernes en la tarde` → `slot:"B"`.
10. **Mensaje 5 — confirmación** — ambos botones convergen aquí.

**Campos personalizados de ManyChat (User Fields, todos texto):** `cf_telefono` (teléfono capturado), `cf_fecha_visita` (fecha/hora legible que rellena el motor), `cf_bici` (modelo, lo rellena el motor). Se crean vacíos; el flujo de IG solo llena `cf_telefono` — los otros los puebla el motor de recordatorios antes de cada envío (§8).

**Cuerpos JSON de las Solicitudes externas** — ver §5. El `{{Nombre de usuario}}` se inserta como **campo de sistema** (username IG), no se escribe a mano.

### 4.2 Gotchas de Instagram / ManyChat (aprendidos, no repetir)

- **Respuesta privada = terminal.** Tras responder a un comentario, IG NO deja encadenar mensajes automáticos. El hilo solo sigue si el usuario **toca un botón de flujo** o responde. → el botón de la ficha debe ser de **flujo**, nunca solo "Abrir URL" (la URL no continúa el flujo).
- **Máximo 3 botones normales por mensaje** en IG (límite de Meta). Quick Replies llegan a ~11 pero no se mezclan con botones.
- **No hay variable de sistema confiable para el Post ID comentado** → la práctica oficial de ManyChat es **una automatización por post**. Por eso el diseño data-driven (`Reels`) + duplicar la automatización es lo correcto (§6).
- **IG no comparte el teléfono del usuario** → no hay autofill mientras el canal sea IG; se escribe a mano. Se resuelve en Fase 3 (botón "Seguir por WhatsApp").
- **Merge tags que no resuelven** (`{{full_name}}` en comentarios) entran como texto literal → NO mandar `nombre` en `mc-lead`; la identidad es el `@handle`.
- **Categoría de plantillas WhatsApp:** ver §8 (el error #1 de rechazo).

---

## 5. Los endpoints del embudo (contratos)

Pages Functions en `functions/api/`. Leen con `AIRTABLE_TOKEN`, escriben con `AIRTABLE_WRITE_TOKEN`. Base `appQUgk8aeD752923`. Todos con retry-on-429 y guarda de no-regresión donde aplica. Protección opcional `MC_KEY` (`?key=`) — hoy **sin setear** → abiertos.

### `mc-lead` — `POST /api/mc-lead`
Da de alta o "toca" un Lead por su `@handle IG` (dedup case-insensitive).
- **Body:** `{ "handle": "<usuario IG>", "canal": "Comentario IG" }` *(no mandar `nombre`)*.
- **Escribe:** si no existe → crea con `@handle IG`, `Canal origen`, `Estado=nuevo`, `Fecha primer contacto` + `última interacción`. Si existe → solo `Fecha última interacción` (nunca pisa Canal/Estado).
- **Devuelve:** `{ ok, leadId, created }`.

### `mc-evento` — `POST /api/mc-evento`
Avanza el Estado + crea un Interés; resuelve la bici vía el reel.
- **Body:** `{ "handle": "...", "estado": "ficha_entregada", "origen": "Puerta 1 (reel/comentario)", "resultado": "Ficha entregada", "reel": "<Post ID>" }` *(o `lead`=recId, `bici`=recId directo)*.
- **Escribe:** Estado (con guarda de no-regresión) + `Fecha última interacción`; crea **Interés** (Lead, Origen, Resultado, Fecha, Bici, Reel). Resuelve la bici por `bici` directo o `reel` → `Reels.Bici`.
- **Devuelve:** `{ ok, leadId, interesId, biciId, estadoActual, estadoAplicado }`.
- **Uso en Fase 3:** el botón "Confirmar" de la plantilla WhatsApp llama aquí con `estado="visita_confirmada"` → Etapa 5, sin endpoint nuevo.

### `mc-agenda` — `GET/POST /api/mc-agenda`
Agenda la visita (Etapa 4).
- **GET** → `{ ok, slots:[{id:"A",label:"sábado 04, 11:00",fecha,hora,fechaVisita}, {id:"B",...}] }`. Slots dinámicos: próximo sábado 11:00 / próximo viernes 18:00 (hora Chile). No chequea calendario real.
- **POST body:** `{ "handle": "...", "slot": "A"|"B", "telefono": "...", "optin": true, "reel": "<Post ID>" }`. Alternativa: `fecha`+`hora` explícitos en vez de `slot` (mandan sobre el slot).
- **Escribe:** Lead → `Fecha visita`, `WhatsApp`, `Opt-in WhatsApp`, `Fecha opt-in`, `Estado=visita_agendada` (con guarda); **Interés** lead↔bici → `Resultado=Agendó` (**reusa** el de la ficha, no duplica; si no existe, crea). Bici: `bici` → `reel`→`Reels.Bici` → fallback al último Interés del lead con bici.
- **Devuelve:** `{ ok, leadId, interesId, interesCreado, biciId, slot, fechaVisita, estadoActual, estadoAplicado }`.
- **Clave de escala:** `slot` se resuelve a fecha en el **servidor** → los botones de horario de ManyChat **no se editan nunca**.

> Endpoints del canal web/venta (documentados en [`DOCUMENTACION.md`](DOCUMENTACION.md) §5): `reservar.js`, `recalcular-embudo.js`, `registrar-venta.js`.

---

## 6. Operación: publicar un reel nuevo (a escala)

El embudo es **una automatización genérica que NO se rediseña**. Lo único que cambia por reel vive en Airtable + un duplicado. Rutina para quien opere:

**Al publicar un reel nuevo de una bici:**
1. En Airtable, tabla **`Reels`**: agregar **1 fila** → `Post ID Instagram` + link a la `Bici` + `Tipo = Ficha-modelo`.
2. En ManyChat: **duplicar** la automatización `Embudo Bike Trust v2` y cambiar unos pocos valores:
   - El **post** del disparador (el reel nuevo).
   - El `reel` (Post ID) en los bodies de `mc-evento` y `mc-agenda`.
   - El `slug` de la ficha en el botón "Abrir ficha".
3. Publicar (Active). En ~5 min queda vivo.

**Cuando la bici se vende:** pausar esa automatización (1 clic). El sitio la saca del catálogo solo (Estado `Vendida`). *(Mejora futura: en vez de pausar, el reel bifurca al quiz — ver §10 "reel evergreen".)*

Con ~14 bicis premium de bajo volumen, se manejan **2-4 automatizaciones vivas** a la vez, no decenas. **El 95% de la operación futura del embudo ocurre en Airtable, no en ManyChat.**

---

## 7. El contrato de datos (que ManyChat DEBE cumplir)

Todo el reporte por período lee de `Leads`. Cada lead del funnel debe:
1. **Nacer con `Fecha primer contacto`** (o no entra a ninguna semana/mes).
2. **Avanzar `Estado`** por los valores canónicos (las banderas de embudo derivan de ahí).
3. **Usar `Canal origen` canónico** (`Comentario IG` / `DM IG` / `Quiz` / …; no inventar variantes).
4. **Deduplicar por `@handle IG`** (leads duplicados inflan los conteos).

Los endpoints ya garantizan esto; respetarlo también en cualquier flujo nuevo.

---

## 8. Fase 3 — Confirmación y recordatorios por WhatsApp ✅ EN VIVO

**Estado (2026-07-07):** **EN VIVO y autónomo.** Número chileno real registrado en Meta, plantillas aprobadas, WhatsApp conectado a ManyChat. El opt-in de WhatsApp se captura en el flujo de Instagram (paso "Recopilación de datos → Teléfono → Guardar como ID de WhatsApp") y quedó **demostrado en producción** que el contacto de IG así se vuelve alcanzable por WhatsApp sin que escriba primero.

**Cadencia final (simplificada 2026-07-07):** al lead → **confirmación** (al agendar) + **recordatorio 48h antes** + **recordatorio a las 8 AM del día**. *(El "2h antes" se dejó fuera por simplicidad; se puede sumar seteando `FLOW_NS_2H`.)*

### Las 4 plantillas (diseño final enviado a aprobar)

Todas en idioma **Spanish (MEX)**, sin encabezado, footer opcional `Bike Trust · Specialized certificadas`. Dirección fija en el cuerpo: `Av. Las Condes 12461`. **Sin variable de nombre** (saludo `¡Hola! 👋`) — los contactos de IG no traen nombre confiable, y "Nombre de página" es el nombre del negocio, no del lead.

| Plantilla | Categoría | Cuerpo | Botones (Quick Reply) |
|---|---|---|---|
| `confirmacion_visita` | **Utility** | `¡Hola! 👋 Tu visita para probar la {{1}} quedó reservada para el {{2}}.` 📍 dirección. `¿Me confirmas que vienes?` | `Sí, confirmo` · `Reagendar` |
| `recordatorio_48h` | **Utility** | `¡Hola! 👋 Te recordamos tu visita para probar la {{1}}: {{2}}.` … `Si necesitas cambiar la hora, toca abajo.` | `Reagendar` |
| `recordatorio_2h` | **Utility** | `¡Hola! 👋 Hoy es tu visita para probar la {{1}} 🚴 Te esperamos a las {{2}}.` … | `Reagendar` |
| `reactivacion_stock` | **Marketing** | `¡Hola! 👋 Tenemos novedades en Bike Trust: {{1}} 🚴 ¿Quieres que te la reservemos?` | `Sí quiero verla` · `Más información` |

- **Variables (bindeadas a campos de ManyChat):** `{{1}}` → `cf_bici` (modelo) · `{{2}}` → `cf_fecha_visita`. En el `recordatorio_2h`, `cf_fecha_visita` lleva solo la hora. Los rellena el **motor** antes de cada envío.
- **Categoría:** Utility = transaccional (aprueba rápido); Marketing = promocional. Meta pausó Marketing solo para números **de EE.UU.** → número chileno OK. Marcar mal la categoría = rechazo #1.
- **Lógica de la secuencia:** la confirmación se pide **una sola vez** (en `confirmacion_visita`). Los recordatorios **solo recuerdan** (no re-preguntan) y dan salida con `Reagendar`.

### Cómo quedó implementado (2026-07-07)

**Confirmación (inmediata):** es el **último paso del flujo de agenda en ManyChat** (nodo WhatsApp "fuera de la ventana de 24h" con la plantilla `confirmacion_visita`). Los datos los llena el **mapeo de respuesta** de la Solicitud externa `mc-agenda`: `biciNombre`→`cf_bici`, `fechaVisitaLegible`→`cf_fecha_visita`. Sale apenas la persona agenda.

**Recordatorios 48h + 8am (motor server-side):**
- **`functions/api/cron-recordatorios.js`** — barre `Leads` (visita futura ≤50h, estado agendada/confirmada, opt-in, con `MC subscriber id`), decide la ventana (48h / 8am del día), puebla `cf_bici`+`cf_fecha_visita` vía la API de ManyChat (`setCustomFieldByName`) y dispara la plantilla (`sendFlow`). Idempotente: estampa `Recordatorio 48h`/`Recordatorio 8am` en el Lead. Envía **solo** las ventanas cuyo `FLOW_NS_*` esté seteado (lanzamiento por fases). Protegido por `CRON_KEY`. `?dry=1` simula sin enviar.
- **`worker-cron/`** — Worker de Cloudflare con Cron Trigger `*/15 * * * *` que le pega al endpoint. Desplegado y verificado (tick real → 200).
- **Captura del `subscriber_id`:** `mc-agenda` recibe `subscriber_id` (System Field "ID de contacto" de ManyChat) en el body y lo guarda en `Leads.MC subscriber id`; el motor lo usa para direccionar el envío. También cachea el modelo en `Leads.MC bici`.
- **Plantilla→ventana:** `recordatorio_48h`→`FLOW_NS_48H` (48h antes) · `recordatorio_2h`→`FLOW_NS_8AM` (aviso de las 8 AM; su texto "hoy es tu visita" calza para la mañana). Env en Cloudflare Pages: `MANYCHAT_TOKEN`, `FLOW_NS_48H`, `FLOW_NS_8AM`, `CRON_KEY`.
- **Reagendar:** el botón "Reagendar" de las plantillas → Solicitud externa a `mc-agenda` (`slot`, `handle`, `subscriber_id`) → reescribe `Fecha visita` + reinicia los flags de recordatorio. El flujo de Reagendar va **dentro** de la ventana de 24h (el toque del botón la abre).

### Lo que falta del #4 🔧

1. **Registrar `visita_confirmada`:** la plantilla `confirmacion_visita` enviada **no trae el botón "Sí, confirmo"** → hoy la confirmación es informativa (no se trackea quién confirma). Para trackearlo: agregar el botón a la plantilla (re-aprobación Meta) + cablearlo a `mc-evento` (`estado=visita_confirmada`). Endpoint ya listo.
2. **(Opcional) Recordatorio de 2h antes:** requiere una 4ª plantilla (`recordatorio_final`, "en un rato te esperamos") aprobada + setear `FLOW_NS_2H`. Se dejó fuera por simplicidad.

---

## 9. Briefing diario al staff 🔧

Cada mañana a una hora fija, un mensaje al celular del staff (y opcionalmente al dueño) con las **visitas de HOY**: nombre/@handle · bici de interés · horario.

- **Mecanismo:** segundo Cron de Cloudflare que lee `Leads` con `Fecha visita = hoy` y envía el resumen por WhatsApp.
- **Nota:** un mensaje automático **no** puede salir del WhatsApp personal de nadie; sale del número del sistema/Bike Trust hacia el staff. Mismo contenido, 100% automático.

---

## 10. Expansión: router del DM + quiz (Puerta 2) + waitlist 💡

Cuando el sistema base esté cerrado (§8 + §9), se abre la Puerta 2. Al escribir al **DM directo** (o responder una historia), el bot muestra un mensaje con **3 botones** que rutean por intención:

| Botón | Intención | Rutea a | Reusa/nuevo |
|---|---|---|---|
| **A · «Sé cuál quiero»** | Vio algo, viene decidido | Ficha + Agenda | reusa lo construido |
| **B · «Ayúdame a elegir»** | No sabe qué le sirve | **Quiz** (Puerta 2) → Match → Agenda | nuevo |
| **C · «Busco algo puntual»** | Modelo/talla que quizás no hay | **Waitlist** "lo conseguimos" | nuevo |

Las 3 rutas terminan en un toque humano real (visita al showroom, o aviso de que se consiguió la bici) → **no se necesita botón de "hablar con persona"**, fiel al principio. Fallback: texto libre raro → reencauza al router / avisa al staff.

**El quiz** (Puerta 2): 3 ejes (motorización · uso/disciplina · presupuesto) + talla → cruza con stock → bici protagonista + alternativa. Rama "no sé mi talla" → sigue igual (se confirma en el chat). Endpoint nuevo **`mc-match`**.

**Reel evergreen (mejora relacionada):** en vez de pausar la automatización cuando la bici se vende, `mc-evento` devuelve si la bici sigue `Disponible`; un bloque **Condición** en ManyChat bifurca: disponible → ficha+agenda, vendida → quiz. El reel recicla su tráfico y nunca se apaga.

**Piezas a construir:** (1) flujo router del DM · (2) flujo del quiz + `mc-match` · (3) captura de waitlist (tabla/campos + endpoint) · (4) conectar respuestas a historia al router.

---

## 11. Roadmap por fases

1. **Fase 1 — Puerta 1** (captura + ficha + califica): `mc-lead` + `mc-evento` + flujo ManyChat. ✅ **En vivo.**
2. **Fase 2 — Agenda**: `mc-agenda` + selector de horario. ✅ **En vivo y probado con usuario real.**
3. **Fase 3 — WhatsApp**: canal + plantillas + confirmación + motor de recordatorios (48h/8am) → mata el no-show. ✅ **En vivo y autónomo (2026-07-07).** Motor `cron-recordatorios` + worker cron `*/15`. Pendiente fino: registrar `visita_confirmada` (falta botón en la plantilla).
4. **Fase base final — Briefing diario a Luis** (8 AM, visitas del día). 🔧 **Próxima pieza.**
5. **Fase 4 — Puerta 2**: router del DM + quiz (`mc-match`) + waitlist + reenganche de sueltos. 💡
6. **Fase 5 — Go-live**: test integral + limpiar datos DEMO + conectar dominio.

---

## 12. Referencias

- [`DOCUMENTACION.md`](DOCUMENTACION.md) — web, CRM, operación del staff, reportes, modelo de datos.
- [`CLAUDE.md`](CLAUDE.md) — notas técnicas finas, gotchas de API, cómo trabajar el repo.
- Código de los endpoints: [`functions/api/`](functions/api/) (`mc-lead.js`, `mc-evento.js`, `mc-agenda.js`, `cron-recordatorios.js`, `reservar.js`, `recalcular-embudo.js`, `registrar-venta.js`).
- Motor de recordatorios / disparador cron: [`worker-cron/`](worker-cron/) (Worker de Cloudflare, `*/15 * * * *`).
