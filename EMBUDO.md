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
| 4 | **Confirmación + recordatorios por WhatsApp** (Fase 3) | ✅ **En vivo, autónomo y VERIFICADO E2E** (2026-07-07): confirmación (al agendar, con botón "Sí confirmo" que registra `visita_confirmada`) + recordatorio 48h + recordatorio 8am. Motor cron cada 15 min. |
| 5 | **Briefing diario al staff** (visitas del día) | 🟡 Backend listo y desplegado; espera aprobación de plantilla Meta + contacto de Luis |
| 5b | **Reenganche + nudges** (no-show, suelto, stock) | 🟡 Motor desplegado; espera plantillas Meta + nudges de IG (armados por el usuario) |
| 6 | **Puerta 2 — router del DM + quiz + waitlist + consignación** | 🔧 Backend listo: `mc-match` + `mc-consigna` construidos y verificados E2E (ver §10). Falta desplegar + armar ManyChat |

**Estado (2026-07-07):** el **embudo base (Puerta 1 comentario → showroom) está EN VIVO y verificado de punta a punta** con una corrida real (lead pasó captura→agenda→confirmación, todo escrito en Airtable, incl. `visita_confirmada`). Pendiente de Meta (relojes corriendo): plantillas del briefing, reenganche y la confirmación v2 (con Reagendar). Sigue: **Puerta 2 (DM) — en rediseño**.

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

### `mc-match` — `POST /api/mc-match` ✅ (Puerta 2)
Corazón de la Puerta 2: consulta el Inventario y rutea según lo **Disponible**.
- **Body (dos modos):** identidad `handle` y/o `subscriber_id` (+ `lead` opcional). **Modo A** `{ modelo: "<texto>" }` · **Modo B (quiz)** `{ motorizacion, disciplina, presupuesto, talla }` (todos opcionales; `talla` puede venir vacía).
- **Match:** *Modo A* — 1 Disponible calza → `hero`; varias (ej. "levo" → 3) → `opciones[]` (ManyChat desambigua, sin Interés todavía); solo vendida/reservada → `no_match` + `alternativa` (misma disciplina) + waitlist; nada → `no_match` + waitlist. *Modo B* — puntúa las Disponibles (disciplina/motorización fuerte, presupuesto, talla blanda) → `hero` + `alternativa`.
- **Escribe:** upsert Lead (si falta y hay handle, nace con contrato mc-lead) → Estado `match_entregado`/`no_match` (con guarda) → **Interés** `Match` (`Es hero`, link Bici, `Crit ·` del quiz) cuando hay UNA bici, o `No-match` + `Modelo buscado` (waitlist). En multi-opción NO crea Interés (se crea al agendar). No duplica.
- **Devuelve:** `{ ok, mode, match, waitlist, hero, alternativa, opciones[], modeloBuscado, leadId, leadCreado, interesId, interesCreado, estadoActual, estadoAplicado }`. Cada bici trae `fichaUrl` (`/ficha/<slug>`, reconstruido igual que build.mjs), `precioCLP`, `foto`, talla, año, disciplina, motorización.
- **Ficha + agenda:** ManyChat usa `hero.fichaUrl` + `hero.biciId` (lo pasa como `bici` a `mc-agenda`, reusando toda la Puerta 1).

### `mc-consigna` — `POST /api/mc-consigna` ✅ (Puerta 2)
Rama "Vender mi bici": crea el registro en **Consignaciones** (estado `Nueva`) + Lead.
- **Body:** `{ handle?, subscriber_id?, modelo, anio?, talla?, estadoBici?, precio?, contacto?, fotos?, notas?, canal? }`. `modelo` obligatorio; identidad por handle o subscriber_id. `fotos` = URL o array (best-effort; si Airtable no las baja, reintenta sin fotos y lo anota).
- **Escribe:** upsert Lead (si nace → `Canal origen=Consignación`; si existe **no pisa** su Canal/Estado) → registro en `Consignaciones` (Modelo, Año, Talla, Estado bici, Precio esperado, Contacto, Fotos, Notas, Estado=`Nueva`, Fecha, link `Lead`).
- **Aviso a Luis (WhatsApp):** tras crear la consignación, manda el resumen (modelo · año · talla · precio · estado · contacto · IG) al WhatsApp del staff vía ManyChat (`cf_consigna_datos` + sendFlow). **Por fases:** requiere plantilla `nueva_consignacion` (Utility) aprobada + env `FLOW_NS_CONSIGNA` + `LUIS_SUBSCRIBER_ID` (+`MANYCHAT_TOKEN`, ya seteada). Sin env → no-op (`aviso:"no_configurado"`); si falla el envío, la consignación igual queda creada. Interín: acción "Notificar a los asignados" en el flujo de ManyChat.
- **Devuelve:** `{ ok, consignaId, leadId, leadCreado, aviso }`. El **contacto humano** lo hace ManyChat (conversación abierta + notificación); el endpoint persiste y avisa.

### `mc-waitlist` — `POST /api/mc-waitlist` ✅ (Puerta 2 · tickets de búsqueda)
Botón **«🎯 Consíganmela»**: convierte un no-match en un **ticket de búsqueda completo** en la tabla **`Solicitudes`** (`tblHnU7eHyhlbxyGM`).
- **Body:** `{ handle?, subscriber_id?, telefono?, optin?, modelo?, talla?, presupuesto?, disciplina?|uso?, motorizacion?, notas? }`. Identidad por handle o subscriber_id (el lead normalmente ya existe, lo creó mc-match). `presupuesto` tolerante ("Hasta $3 millones" → 3000000). Ignora merge tags sin resolver (`{{cuf_…}}`) en todos los campos de texto.
- **Escribe:** **Solicitud** → Modelo buscado, Talla, Presupuesto, Disciplina, Motorización, Notas, Contacto, `Estado=Nueva`, `Origen=Bot DM`, Fecha, link `Lead`. **Lead** → `WhatsApp` + `Opt-in WhatsApp` + `Fecha opt-in` + `MC subscriber id`. **Interés** → el `No-match` más reciente pasa a `Encargo`=✓ (marca de embudo, best-effort).
- **Devuelve:** `{ ok, encargo, solicitudId, leadId, leadCreado, interesId, modeloBuscado }`.
- **Cola de sourcing = tabla `Solicitudes`** (Estado `Nueva → Buscando → Conseguida → Cerrada`): el staff la trabaja desde la interfaz (cards) y crea tickets manuales por formulario en la misma tabla (`Origen=Manual`). Además de recuperar al lead, dice **qué bicis salir a conseguir**. Aviso al conseguirla: manual hoy; plantilla `reactivacion_stock` a futuro.
- **Aviso a Luis (WhatsApp):** tras crear el ticket, manda el resumen (modelo · talla · presupuesto · notas · contacto · IG) al staff vía ManyChat (`cf_solicitud_datos` + sendFlow). **Por fases:** requiere plantilla `nueva_solicitud` (Utility) aprobada + env `FLOW_NS_SOLICITUD` + `LUIS_SUBSCRIBER_ID` (+`MANYCHAT_TOKEN`). Sin env → no-op (`aviso:"no_configurado"`); si falla, el ticket igual queda creado. Mismo patrón que el aviso de consignaciones de mc-consigna.

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

## 10. Puerta 2 — Embudo de entrada por DM (diseño completo) 🔧

Entrada: **DM directo** o **respuesta a historia** → ambos caen en el **Router**. Diseño autoritativo (2026-07-07). Reusa todo lo de Puerta 1 (mc-lead/mc-evento/mc-agenda) y agrega el router + `mc-match` + consignación.

### Router (bienvenida)
Mensaje: *"¡Hola! 👋 Soy el asistente de Bike Trust. ¿En qué te ayudo?"* → **3 botones**: `🚴 Comprar` · `💰 Vender mi bici` · `💬 Consultar`. Capa de **AI/keywords** encima: si escriben libre, clasifica la intención y rutea; si no entiende → muestra el menú. Fallback final: *"Te conecto con una persona"* (asigna humano).

### Rama 1 — 🚴 COMPRAR (sub-menú: `Sé cuál quiero` · `Ayúdame a elegir` · `Solo ir a verlas`)
- **1a · Modelo específico:** bot pide el modelo → **`mc-match`** consulta Inventario → **Disponible:** ficha + agenda (reusa Puerta 1) · **No disponible:** ofrece similar (misma disciplina/talla/rango) + **waitlist** "te aviso cuando llegue". Airtable: Lead `Canal=DM IG` + Interés `Origen=Puerta 2`.
- **1b · Ayúdame a elegir (quiz):** 4 preguntas (motorización · uso/disciplina · presupuesto · talla) → **`mc-match`** cruza con stock → **protagonista + alternativa** → ficha + agenda. "No sé mi talla" → sigue igual (se confirma en la visita). Airtable: Lead `Canal=Quiz` + Interés `Match`.
- **1c · Solo ir a verlas:** directo al selector de horarios → agenda "showroom general" (sin bici específica).

### Rama 2 — 💰 VENDER (Consignación)
Bot: *"Para consignar tu bici, cuéntame algunos datos 📋"* → **captura** (Recopilación de datos): modelo · año · estado/km (batería si eléctrica) · precio esperado · fotos · teléfono → *"¡Listo! Un especialista te contactará."* → **asigna la conversación a un humano** (staff) + escribe el registro. Airtable: tabla nueva **`Consignaciones`** (link a Lead con `Canal=Consignación`).

### Rama 3 — 💬 CONSULTAR (FAQ + reenganche)
Sub-menú: `¿Cómo certifican?` · `Precios / pago` · `Ubicación`. Respuestas armadas → link a "Cómo certificamos" / catálogo → **botón "Agendar visita"** al final (los devuelve a compra). Airtable: Lead tibio `Canal=DM IG`.

### Piezas a construir
| Pieza | Nueva/Reusa | Estado |
|---|---|---|
| **`mc-match`** (endpoint) | 🆕 corazón de Puerta 2 | ✅ **Construido + verificado E2E** (21/21). Match modelo (1a) + quiz (1b) + alternativa + waitlist |
| **`mc-consigna`** (endpoint) | 🆕 | ✅ **Construido + verificado E2E** (16/16). Escribe la consignación + upsert Lead |
| Tabla **`Consignaciones`** | 🆕 | ✅ Ya existía + se le agregó el link `Lead` (`fldcKfqUaZq43rXK3`) |
| Waitlist | 🆕 | ✅ Interés `No-match` + campo **`Modelo buscado`** (`fldF2HMPpUjah094S`) creado |
| Opción `Consignación` en `Canal origen` | ajuste | ✅ Agregada (la crea mc-consigna vía typecast) |
| Router + FAQ + agenda directa + consignación | ManyChat | 🔧 **Por armar** (reusa mc-lead/mc-evento/mc-agenda + los 2 nuevos) |
| Reel evergreen | ManyChat | 🔧 Por armar (mc-match ya rutea vendida→alternativa) |

> **Nota de build (2026-07-07):** el Interés del quiz usa los campos `Crit · motorización/disciplina/presupuesto/talla` + `Es hero` que ya existían en `Intereses`. Ambos endpoints leen `AIRTABLE_TOKEN` / escriben `AIRTABLE_WRITE_TOKEN`, patrón mc-agenda (retry-429, `MC_KEY` opcional). **Falta desplegarlos** (push a main) para que ManyChat los alcance.

### Reel evergreen (conecta Puerta 1 → Puerta 2)
Cuando una bici se vende, en vez de pausar su reel, `mc-evento` devuelve si sigue `Disponible`; un bloque **Condición** en ManyChat bifurca: disponible → ficha+agenda · vendida → **quiz (Puerta 2)**. El reel nunca se apaga y recicla el tráfico.

### Orden de build
1. ✅ **`mc-match` + `mc-consigna`** (backend, el build grande) — construidos y verificados E2E 2026-07-07.
2. 🔧 **Desplegar** (push a main) + armar en ManyChat el **router + sub-flujos + FAQ + agenda directa + consignación** (reusa mc-lead/mc-evento/mc-agenda + los 2 nuevos).
3. 🔧 **Waitlist visible + reel evergreen** (recuperación; mc-match ya devuelve la alternativa y el flag waitlist).

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
