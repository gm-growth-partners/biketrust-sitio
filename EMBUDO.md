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
| 4 | **Confirmación + recordatorios por WhatsApp** (Fase 3) | ⏸️ Bloqueado por acceso a Meta |
| 5 | **Briefing diario al staff** (visitas del día) | 🔧 Por construir |
| 6 | **Puerta 2 — router del DM + quiz + waitlist** | 💡 Diseñado, en fila |

**Qué falta para "sistema base terminado":** #4 (WhatsApp) + #5 (briefing). Después se abre la expansión #6.

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
| 5 | **Confirma + recuerda** — plantillas 48h/2h | WhatsApp | 🤖 | Estado → `visita_confirmada` (botón "Confirmar" → `mc-evento`) | ⏸️ |
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

**Campos personalizados de ManyChat necesarios:** `cf_telefono` (texto), `cf_fecha_visita` (texto, opcional para eco).

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

## 8. Fase 3 — Confirmación y recordatorios por WhatsApp ⏸️

**Dependencia dura:** conectar **WhatsApp Business API a ManyChat** (número de WhatsApp Business + Meta Business + aprobación de plantillas, 24-48h). ManyChat Pro soporta el canal. Sin esto, captura+ficha+agenda en IG funcionan, pero recordatorios/reenganche no. *(Estado 2026-07-03: número conseguido; a la espera de acceso total a Meta.)*

**Qué construir:**
1. **Conectar el número** en ManyChat (Settings → Channels → WhatsApp).
2. **4 plantillas** enviadas a aprobar (categoría correcta = error #1 de rechazo):

| Plantilla | Categoría | Cuerpo (variables) |
|---|---|---|
| `confirmacion_visita` | **Utility** | `¡Hola {{1}}! 👋 Tu visita para probar la {{2}} quedó reservada para el {{3}}.` 📍 `[dirección]`. `¿Me confirmas?` · Botones: `✅ Sí, confirmo` · `🔁 Reagendar` |
| `recordatorio_48h` | **Utility** | `¡Hola {{1}}! 👋 Te recordamos tu visita para probar la {{2}}: {{3}}.` … `¿Nos confirmas?` · `✅ Confirmar` · `🔁 Reagendar` |
| `recordatorio_2h` | **Utility** | `¡Hola {{1}}! 👋 Tu visita es hoy a las {{2}}. Te esperamos en [dirección] 🚴 ¿Nos vemos?` · `👍 Ahí estaré` · `🔁 Reagendar` |
| `reactivacion_stock` | **Marketing** | `¡Hola {{1}}! 👋 Tenemos novedades: {{2}}. ¿Quieres que te la reservemos?` · `🚴 Sí, me interesa` · `🔁 Ahora no` |

- **Utility** = transaccional (aprueba rápido); **Marketing** = promocional. Meta pausó Marketing solo para números **de EE.UU.** → número chileno OK. **No poner lenguaje promocional en las Utility** o el clasificador las rechaza.
- Sin links acortados ni `wa.me`. Variables: `{{1}}`=nombre (perfil WhatsApp, con fallback), `{{2}}`=modelo, `{{3}}`=fecha+hora.
- **El botón "Confirmar" retoma el flujo → `mc-evento` con `estado=visita_confirmada`** = Etapa 5 del embudo.
3. **Motor de recordatorios** 🔧 — Cron de Cloudflare que barre `Leads.Fecha visita`, detecta visitas a 48h/2h, encuentra el contacto en ManyChat (por teléfono/handle) y dispara la plantilla vía la API de ManyChat.

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
3. **Fase 3 — WhatsApp**: conectar canal + plantillas + motor de recordatorios → mata el no-show. ⏸️ **Bloqueado por Meta.**
4. **Fase base final — Briefing diario** al staff. 🔧
5. **Fase 4 — Puerta 2**: router del DM + quiz (`mc-match`) + waitlist + reenganche de sueltos. 💡
6. **Fase 5 — Go-live**: test integral + limpiar datos DEMO + conectar dominio.

---

## 12. Referencias

- [`DOCUMENTACION.md`](DOCUMENTACION.md) — web, CRM, operación del staff, reportes, modelo de datos.
- [`CLAUDE.md`](CLAUDE.md) — notas técnicas finas, gotchas de API, cómo trabajar el repo.
- Código de los endpoints: [`functions/api/`](functions/api/) (`mc-lead.js`, `mc-evento.js`, `mc-agenda.js`, `reservar.js`, `recalcular-embudo.js`, `registrar-venta.js`).
