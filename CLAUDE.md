# CLAUDE.md — Bike Trust · Guía de sistema y trabajo

> Este archivo lo lee Claude Code automáticamente al iniciar sesión en este repo.
> Es la **memoria viva del proyecto**. Idioma de trabajo: **español**.
> Última actualización: **2026-07-27** (rediseño V2: el embudo apunta a la llamada).

## 🧭 EMPIEZA ACÁ

**El sistema está a mitad de un rediseño (V2).** Antes de tocar nada, ubícate:

| Si necesitas… | Lee |
|---|---|
| **Entender qué pasó y por qué** (decisiones ya tomadas — no re-discutirlas) | [`CHANGELOG.md`](CHANGELOG.md) ← **partir por acá** |
| El estado de cada pieza y qué falta | §2 de este archivo |
| **El diseño V2** (qué se está construyendo ahora) | [`MANYCHAT_REBUILD.md`](MANYCHAT_REBUILD.md) §0.5–0.7 |
| La pantalla de Luis (Kanban) | [`docs/V2_OPERACION_KANBAN.md`](docs/V2_OPERACION_KANBAN.md) |
| El copy exacto de la puerta de comentarios | [`docs/V2_PLANTILLA_COMENTARIOS.md`](docs/V2_PLANTILLA_COMENTARIOS.md) |
| El copy de la puerta de DM + anti-bucle | [`docs/V2_PLANTILLA_DM.md`](docs/V2_PLANTILLA_DM.md) |
| Qué mensaje sale en cada salida de la llamada | [`docs/V2_SALIDAS_LLAMADA.md`](docs/V2_SALIDAS_LLAMADA.md) |
| Qué dice Luis por teléfono | [`docs/V2_GUION_LLAMADA.md`](docs/V2_GUION_LLAMADA.md) |
| Modelo de datos, endpoints, gotchas | §3–§5 de este archivo |
| Cómo trabajar este repo (expectativas del usuario) | §7 de este archivo |
| El embudo V1 (**histórico** — la capa conversacional está en retiro) | [`EMBUDO.md`](EMBUDO.md) |

> ⚠️ **`EMBUDO.md` §4 y §10 describen la capa ManyChat V1, que se está reemplazando.**
> Sus contratos de endpoints (§5), la máquina de estados (§3) y la operación por reel (§6)
> **siguen vigentes**. El resto se lee como histórico.

---

## 1. Qué es el sistema

Bike Trust vende bicicletas **Specialized usadas, premium y certificadas** (Santiago, Chile).

- **Web** (capa de confianza): sitio estático generado desde Airtable, en Cloudflare Pages.
- **Backend / CRM** (la "espina"): **Airtable es la única fuente de verdad**. Inventario, Leads, Intereses, Reservas, Reels, Llamados, Solicitudes, Consignaciones.
- **Funnel** (Instagram + ManyChat): V1 EN VIVO desde 2026-07-10. **Capa conversacional en reconstrucción (V2)**.
- **Tablero de reporte**: app separada (repo `biketrust-tablero`), solo lectura.

**Principio rector:** todo lee/escribe en Airtable. Nada guarda su propia copia.

**El embudo V2 en una línea:**
```
comentario/DM → el bot entrega valor (puntaje · estado honesto · ahorro)
              → pide el TELÉFONO  → ticket → aviso a Luis
              → Luis llama y arrastra la tarjeta a una de 5 salidas
              → sale el mensaje automático que corresponde
```
El objetivo del bot es **el teléfono**, no la visita. La visita la cierra Luis en la llamada.
Meta del dueño: **20–30 % de los leads entregan teléfono** (semana 30 = 3 %).

---

## 2. Estado actual (2026-07-27)

| Frente | Estado |
|---|---|
| 🟢 **Web** | EN VIVO (https://biketrust-sitio.pages.dev). Catálogo, fichas e-commerce, reservas, guías, SEO (OG/sitemap/robots/favicon/404), **ficha técnica PDF auto-generada**. |
| 🟢 **Backend/CRM** | OPERATIVO y verificado E2E. Inventario + Leads + Intereses + Reservas. Reserva web→Lead+Intereses automático. |
| 🟢 **Interfaces Airtable** | **Control de Inventario** (form alta + panel + por completar), **Pipeline CRM** (Kanban), **Reportes** (semanal/mensual/global por período), **Agenda** (calendario de visitas). |
| 🟢 **Reporting por período** | 3 páginas (semana/mes/global) desde tabla `Metricas` precalculada por `functions/api/recalcular-embudo.js` (botón manual). Facturación reconstruida desde cierres. |
| 🟢 **Conexión de venta** | `functions/api/registrar-venta.js` EN VIVO y probada con clic real: deja Lead `cerró`+fecha · Interés `Cerró` · Bici `Vendida`+fecha en una llamada. Disparo desde Leads/Agenda (botón Open URL). |
| 🟢 **Funnel ManyChat (P1 + P2)** | EN VIVO, autónomo y **con candado (`MC_KEY`, 2026-07-09)**. Puerta 1 (comentario→ficha→agenda) + Puerta 2 (router DM → modelo exacto · quiz por **estatura** · solo ir a verlas · «Consíganmela» con `encargo_recibido` al cliente · Vender con aviso a Roberto · FAQ temporal) + **región en AMBAS puertas** ("¿Estás en Santiago?" → ticket `Llamados`). Confirmación + recordatorios 48h/8am. 4 corridas reales + viaje sintético 14/14 (2026-07-09). |
| 🟢 **Sourcing (Puerta 2)** | Tablas **`Solicitudes`** y **`Consignaciones`** (+`Origen` Bot DM/Manual) con páginas cards, formularios manuales y automatizaciones de completado. **Oferta aceptada → la bici nace sola en Inventario (Borrador)**, verificado E2E. Avisos WhatsApp al equipo construidos (`FLOW_NS_SOLICITUD`/`FLOW_NS_CONSIGNA` definidos) — 🟡 esperan plantillas Meta. |
| 🟢 **Venta única** | Form `/api/registrar-venta?form=1` (bici + lead agendado o walk-in + **precio efectivo** + método de pago) EN VIVO, botón en Panel de inventario. La facturación del reporte usa el precio efectivo. |
| 🟢 **Avisos WhatsApp al staff** | EN VIVO (2026-07-09): briefing 8AM (Luis+Roberto) · nueva solicitud · nueva oferta · `encargo_recibido` al cliente. 🟡 Esperan Meta: `nuevo_llamado` y `visita_reagendada` (tickets igual se crean; se ven en pantalla). |
| 🟢 **Tablero de reporte (Anexo A3)** | EN VIVO (2026-07-17) — app web privada **SEPARADA** (repo/proyecto Pages `biketrust-tablero`, carpeta `…/2. Fragua/tablero`). Lee ESTA misma base y calcula 19 métricas en build time; gate server-side (clave compartida) + disparador (Deploy Hook). Solo lectura. **Agregó campos + 3 automatizaciones a esta base** (ver §4). §06 verificado. Su propio `README.md` tiene el estado. |

**FOCO ACTUAL (2026-07-30): cerrar la etapa Embudo V2 — los 5 ítems de [`docs/V2_PLAN_CIERRE_ETAPA.md`](docs/V2_PLAN_CIERRE_ETAPA.md).** La puerta de comentarios ya está **EN PRODUCCIÓN** (4 reels, E2E verificado); sigue: interfaz de Llamados + guía a Luis → reels sin bici → puerta de DM → gran doc → tablero con roles (el cierre). *(Contexto del pivote, abajo — histórico:)* Pivote: **intención en vez de menú** (4 rutas: modelo específico · asesoría · vender · pregunta general) y **convergencia única en agenda** (ubicación decide: Santiago → visita `mc-agenda` · región → llamada `mc-llamado`). Diseño, plan y fe de erratas: `MANYCHAT_REBUILD.md` §0.5–0.7; spec de montaje: `docs/cuaderno_montaje_biketrust.html`. Motiva: S30 con 27 fichas entregadas y 0 agendas; 5 DMs libres varados. Acompañan (código): umbral no-match en quiz · emitir `quiz_iniciado` · hora exacta en Llamados · semana en curso en el tablero. *(Foco anterior 2026-07-08 —sistema operativo completo— CUMPLIDO y lanzado 2026-07-10; limpieza de prueba hecha 2026-07-27.)*

⚠️ **DECISIÓN 2026-07-20 (reunión con los dueños) — AILOO = ERP CENTRAL; el embudo se corta en show/no-show.**
- **Ailoo** (ERP chileno donde BikeTrust factura y donde vive biketrust.cl) pasa a ser el sistema central. Se acordó pedirle a Ailoo **dos automatizaciones hacia Airtable**: (1) **alta de bici** → la bici nace en Inventario lista para publicar (requiere **campos personalizados** en el form de producto de Ailoo — talla/año/motorización/etc. como campos, NO texto libre en la descripción; es REQUISITO, no nice-to-have); (2) **venta** → la bici queda `Vendida` + llegan los datos del comprador.
- **Trazabilidad de venta:** doble amarre — **teléfono del comprador** (pedido en tienda) ↔ `Leads.WhatsApp` (nivel persona) y **código único por unidad** (campo tipo "SWSS" de Ailoo, análogo a una patente) ↔ columna nueva `SWSS` en Inventario (nivel bici; conecta también reel→bici→venta). Cada venta se clasificará: match por teléfono / match por bici / sin rastro.
- **Alcance del embudo = hasta show/no-show.** El staff ya NO registrará "Compró" en Airtable cuando la automatización de venta esté viva: `registrar-venta` (form, botón 💰, cascada) queda **supersedido como camino principal** (mantener de fallback hasta que Ailoo esté probado). El formato Word de descripción (`Formato_descripcion_bicicletas_Ailoo.docx`) y la replicación manual de Gabriel quedan como **puente transitorio**.
- **Estado:** Ailoo NO tiene API pública ni webhooks documentados (sí sincroniza productos con Shopify/WooCommerce/Mercado Libre → es capacidad que ya tienen; cobran por algunas integraciones). Mensaje de requerimiento a Ailoo (contacto: "Gina") **redactado, EN PAUSA** hasta que Luis muestre el proceso real de subida/venta en Ailoo. Recepción lado nuestro = 2 Pages Functions futuras (`/api/ailoo-bici`, `/api/ailoo-venta`), patrón mc-*. Detalle completo: memoria de Claude `project_biketrust_ailoo_integracion.md`.

⚠️ **REDISEÑO 2026-07-01 — arquitectura 100% automatizada.** El embudo se automatiza de punta a punta hasta el showroom; el humano solo cierra en tienda (y escala precio). El "cerrador humano en el agendamiento" del diseño original se reemplaza por **agenda-en-el-chat + recordatorios por WhatsApp** (Instagram no deja mandar fuera de la ventana de 24h; WhatsApp con plantillas sí). **Documento autoritativo del diseño: `…/2. Fragua/ARQUITECTURA_EMBUDO.md`** (7 etapas, dependencia dura = conectar WhatsApp Business API a ManyChat). Plan operativo día a día: `…/2. Fragua/PLAN_embudo.md`.

**Estado de fases:** Fase 1 (Puerta 1 = captura + ficha + calificación en ManyChat, con `mc-lead`/`mc-evento` en vivo) = **en curso**. Sigue: Fase 2 `/api/mc-agenda` + selector de horarios · Fase 3 WhatsApp + recordatorios · Fase 4 reenganche + Puerta 2 (quiz `/api/mc-match`).

**Pendiente inmediato (RETOMAR — pausado 2026-06-30, en segundo plano mientras se cierra el embudo):** terminar el wiring del botón de venta en la **Agenda** (probar edición inline de `Bici comprada` en vista previa; elegir botón nativo con URL+campo `RecID` o el botón-campo ya funcional; probar con DEMO antes de quitar el otro; dar permiso **Editar** al staff al compartir). Detalle completo en la memoria de Claude `project_biketrust_reporte_metricas.md`.

**Pendientes menores:** ~~limpiar datos DEMO~~ ✅ hecho 2026-07-27 (ver §8.2); colores en cards de inventario + botón "+ Nueva bici"; reconstruir/limpiar facturación demo; conectar dominio `biketrust.cl` (setear env `SITE_URL` en Cloudflare al hacerlo). **Env Cloudflare nuevas:** `RECALC_KEY` (reporte) y `VENTA_KEY` (registrar-venta).

---

## 3. Arquitectura y datos técnicos

- **Repo:** github.com/gm-growth-partners/biketrust-sitio (rama `main`, auto-deploy on push). El repo hermano del tablero es `biketrust-tablero`, y en disco vive como carpeta gemela de esta.
- **Build:** `build.mjs` (Node, sin dependencias, `fetch` nativo). Lee la vista **Disponibles** de **Inventario** y genera `/dist` (catálogo + ficha por bici + ficha técnica imprimible + SEO).
- **Airtable:** base `appQUgk8aeD752923` ("Biketrust Operaciones").
- **Pages Functions** (lado servidor; leen con `AIRTABLE_TOKEN`, escriben con `AIRTABLE_WRITE_TOKEN`):
  - `functions/api/reservar.js` — reserva web → Reservas + upsert Lead + Intereses (best-effort). Estampa `Fecha visita`.
  - `functions/api/recalcular-embudo.js` — recalcula la tabla `Metricas` por período (botón manual). Protegida por env `RECALC_KEY`.
  - `functions/api/registrar-venta.js` — venta atómica (Lead cerró + Interés Cerró + Bici Vendida + fechas) + **cascada de tickets**: cierra solos los `Solicitudes`/`Llamados` abiertos del comprador (links inversos en Leads; best-effort, la venta no falla por esto). Toma la bici de `Leads.Bici comprada` o del param `bici`. GET (botón Open URL) + POST. Protegida por env `VENTA_KEY`. Tiene retry-on-429.
  - `functions/api/mc-lead.js` — **puente ManyChat**: upsert de Lead por `@handle IG` (dedup). POST. Protegida por `MC_KEY` (**ACTIVA desde 2026-07-09** — igual que todos los puentes mc-*; toda Solicitud externa nueva en ManyChat debe llevar `?key=`).
  - `functions/api/mc-evento.js` — **puente ManyChat**: avanza `Estado` del lead (con guarda de no-regresión) + crea Interés; resuelve la bici directo o vía el reel comentado (`Reels.Bici`). POST. Protegida por env opcional `MC_KEY`.
  - `functions/api/mc-match.js` — **Puerta 2 (corazón)**: recibe un modelo en texto (rama "sé cuál quiero") o los criterios del quiz → consulta Inventario → devuelve la bici Disponible que hace match (o alternativa + waitlist) + escribe Lead/Interés (`Match`/`No-match`). Modo quiz recomienda por **estatura** (`altura` → `Rango altura` de cada bici). POST. EN VIVO.
  - `functions/api/mc-consigna.js` — **Puerta 2 (vender)**: crea el registro en `Consignaciones` (estado `Nueva`) + upsert Lead (`Canal=Consignación`) + aviso WhatsApp a Roberto/Luis (`AVISO_CONSIGNA_SIDS`, EN VIVO). POST. EN VIVO.
  - `functions/api/mc-waitlist.js` — **Puerta 2 (Consíganmela)**: crea el **ticket de búsqueda** en `Solicitudes` (modelo/talla/presupuesto/notas, Estado=Nueva, Origen=Bot DM, link Lead) + teléfono/opt-in en el Lead + marca `Encargo`=✓ en el Interés No-match + aviso al staff (por fases). POST. Verificado E2E. Protegida por env opcional `MC_KEY`.
  - `functions/api/mc-llamado.js` — **Puerta 2 (región)**: ticket de LLAMADO en tabla `Llamados` para leads fuera de Santiago (ciudad/franja/bici de interés/teléfono). **NO escribe `Fecha visita`** (no dispara recordatorios). Aviso al staff por fases. POST. Verificado E2E.
  - **Avisos al staff multi-destinatario (todos por fases hasta que Meta apruebe):** `AVISO_CONSIGNA_SIDS` / `AVISO_SOLICITUD_SIDS` / `AVISO_LLAMADO_SIDS` / `AVISO_REAGENDO_SIDS` / `BRIEFING_SIDS` = ids de ManyChat separados por coma, fallback `LUIS_SUBSCRIBER_ID`. Luis=`579628082` · Roberto=`302195575`. mc-agenda además avisa el **reagendo del mismo día** (`FLOW_NS_REAGENDO`).
  - `functions/api/salida-llamado.js` — **motor de POST-LLAMADA (V2)**. Lo dispara Airtable cuando Luis mueve la tarjeta en el Kanban. Hace tres cosas que antes no hacía nadie: (1) **propaga el permiso** del ticket al Lead — los crons filtran por `Leads.Opt-in WhatsApp`, así que sin este puente el motor de recordatorios devuelve 0 **sin dar error**; (2) **copia la visita agendada por teléfono** a `Leads.Fecha visita` y limpia los sellos de recordatorio; (3) dispara la plantilla que corresponde a la salida, con sello de idempotencia. POST, protegido por `MC_KEY`.
  - `functions/api/cron-sourcing.js` — barrido que avisa a Roberto y Alfonso los encargos que pasan a `Buscando`. **Es un cron, NO una automatización de Airtable** (esas son limitadas y se pagan). Lo llama el worker cada 15 min.
  - **Gotcha API (nuevo):** el GET de **un registro único** (`/Tabla/{recId}`) **NO acepta `?fields[]=`** (da 422); eso solo va en el endpoint de LISTADO. Leer el registro completo.
- **Tokens (SOLO env, NUNCA en repo):** `AIRTABLE_TOKEN` (read) y `AIRTABLE_WRITE_TOKEN` (write) en Cloudflare. Para que Claude trabaje datos/esquema por API hay un **PAT en `.dev.vars`** (gitignored) como `AIRTABLE_PAT`. **El PAT se pegó una vez en el chat — conviene rotarlo.**

### Cómo Claude trabaja Airtable
- **Datos y esquema** → directo por API (curl/python con `AIRTABLE_PAT` de `.dev.vars`).
- **Interfaces, Form views, Kanban, Automatizaciones, lookups, rollups, opciones de select** → NO hay API. Se hacen con **Omni** (la IA de Airtable) o **manual**, y **Claude guía paso a paso**.

---

## 4. Modelo de datos (lo esencial — NO renombrar campos sin avisar; alimentan web y funnel)

- **Inventario** (la bici): primario `Etiqueta` (fórmula Marca+Modelo+Talla). `Estado` (single select): `Borrador · En reacondicionamiento · Disponible · Reservada · Vendida` (solo `Disponible` se publica). Campos de ficha: Marca, Modelo, Año, Motorización, Disciplina, Talla, Precio, Precio nuevo, Puntaje certificación, Diag·(km/batería/ciclos), Specs clave, Geometría, Estado honesto, Por qué amarla, Rango altura, Material cuadro, Referencia, **Fotos galería** (campo único de fotos). Counts (rollup): Interesados, Recibió ficha, Agendaron, Cerraron. `Fecha venta`. ⚠️ Inventario **NO** tiene campo `DEMO` (solo Leads/Intereses lo tienen) — las bicis de prueba se siembran y borran **por id**.
- **Etapa «teléfono» del embudo V2 (2026-07-27):** en **Leads**, `Fecha teléfono` (dateTime, la sella `mc-llamado` UNA sola vez) + `Llegó a teléfono` (fórmula 1/0 derivada de esa fecha, **no del Estado**, para que no pueda retroceder). Es la **métrica #1 del negocio** y la lee el tablero.
- **Leads** (la persona): **primario `Lead`** = fórmula `IF({Nombre},{Nombre},IF({Email},{Email},IF({@handle IG},"@"&{@handle IG},"Sin nombre")))`. `Estado` = máquina de 13 estados (`nuevo → ficha_entregada / quiz_iniciado → quiz_abandonado / match_entregado / no_match → visita_agendada → visita_confirmada → no_show / visitó → cerró`; terminales `muerto`, `descartado`). `Canal origen` (opciones reales: `Comentario IG`/`DM IG`/`Quiz`/`Messenger`/`WhatsApp`/`Web`/`Tienda` — `WhatsApp` es opción colada, limpiar manual), **`@handle IG`** (usuario IG sin @, identificador de dedup del funnel — lo usan `mc-lead`/`mc-evento`), `Temperatura`, `WhatsApp`, `Email`, fechas (`Fecha primer contacto`, `Fecha última interacción`, **`Fecha visita`** dateTime, **`Fecha cierre`**), flags 1/0 (`Llegó a ficha/agendó/confirmó/visitó/cerró`), `¿Suelto?` (fórmula reenganche >3 días), `Valor potencial` (rollup SUM), `RecID` (RECORD_ID()), **`Bici comprada`** (link a Inventario, single — la bici que se llevó), **`Registrar venta`** (botón Open URL → `/api/registrar-venta`), links Intereses/Reservas, `DEMO`.
- **Intereses** (lead↔bici): primario `Interés ID` (autonumber). `Origen` (Puerta 1/Puerta 2/Web (ficha)), `Resultado` (Ficha entregada/Match/No-match/Agendó/Cerró), links Lead/Bici/Reel/Reservas, `Precio Bici` (lookup Bici→Precio), `DEMO`.
- **Reservas**: campos que escribe la web (Nombre, Email, Teléfono, Fecha, Hora, Modelos, Modelos Slug, **Bici IDs**, Origen=Web, Estado=Nueva) + links Leads/Intereses.
- **Reels** (`tbloabbormHNCAWv1`, mapa Post ID → bici): primario `Post ID Instagram` (el **shortcode** de la URL, ej. `DbCLcpEB4aT` de `instagram.com/p/DbCLcpEB4aT/`), `Palabra clave` (la que el caption pide comentar; es el título que muestra el tablero), `Tipo` (`Ficha-modelo`/`Marca-autoridad`/`General`), `Fecha publicación`, link `Bici`, link inverso `Intereses`. La leen `mc-evento` y `mc-llamado` para resolver la bici del reel comentado. **6 filas al 2026-07-27** — `DbCLcpEB4aT` Epic 8 Pro · `DZ1O3ViO2Qz` Levo 4G S-Works · `Dad9A_zJy0D` Levo SL2 S-Works · `DbQjdNLBmnv` Creo (Creo SL S-Works) · `DbEh9fBI9Np` SL (Levo SL S-Works) · `DbJy7ynB5T4` Ruta (VS Tarmac/Creo, **sin `Bici` a propósito**: deriva al quiz, y enlazar una bici haría que `mc-evento` la forzara). ⚠️ Una fila acá **no basta**: ManyChat no expone el Post ID comentado, así que cada post necesita su propia automatización mandando su shortcode en `reel` (ver `EMBUDO.md` §6). Sin eso el Interés nace sin `Reel` y el tablero no lo atribuye a ningún video.
- **Consignaciones** (`tblQTsCHnf8ebO2T1`, rama Vender de Puerta 2): Modelo, Año, Talla, Estado bici, Precio esperado, Contacto, Fotos, `Estado` (`Nueva/En evaluación/Aceptada/Rechazada`), Fecha, Notas, link `Lead`. La escribe `mc-consigna`.
- **Solicitudes** (`tblHnU7eHyhlbxyGM`, tickets de búsqueda «Consíganmela»): primario `Modelo buscado`, Motorización, Disciplina, Talla, Presupuesto (currency), Notas, `Estado` (`Llamada pendiente/Buscando/Conseguida/Cerrada`), Fecha, Contacto, `Origen` (`Bot DM/Manual`), link `Lead`. La escribe `mc-waitlist` (bot) y el staff por formulario (manual). Es la cola de sourcing. **Cerrada = cuando el cliente COMPRA.**
- **Llamados** (`tblgApNKo9YiqPalw`) — ⚠️ **con el V2 dejó de ser «tickets de región» y pasó a ser LA COLA CENTRAL del embudo**: todo lead que entrega su teléfono cae acá. Es la pantalla donde trabaja Luis (Kanban por `Salida`).
  - **Identidad:** primario `Nombre`, `Teléfono`, `Ciudad`, `Bici de interés` (link), `Lead` (link), `Notas`, `Origen`, `Fecha`, `Franja`, `Llamar el`.
  - **El brief de la llamada** (lookups automáticos vía `Bici de interés`): `Puntaje` · `Rango altura bici` · `Precio bici` · `Estado bici`. Luis no los llena: se pueblan solos.
  - **Lo que registra Luis:** **`Salida`** (el campo que gobierna el Kanban y dispara los mensajes) · `Estatura (cm)` · `Permiso WhatsApp` (⚠️ el consentimiento: sin esto marcado NO se le escribe) · `Fecha y hora de visita` · `Próximo paso` · `Intentos`.
  - **Instrumentación:** `Creado`, `Fecha primera llamada`, `_ahora`, **`Espera (min)`** (minutos exactos entre ticket y primera llamada — la métrica de velocidad), **`Aviso salida enviado`** (sello de idempotencia del mensaje automático).
  - La escribe `mc-llamado` (acepta `bici` recId o `reel` Post ID → `Reels.Bici`) y la lee/actualiza `salida-llamado`.
- **Estado "Llamada pendiente"** (renombrado desde "Nueva" 2026-07-09, en Solicitudes Y Llamados): un ticket del bot nace ahí = **Luis debe llamar**; tras llamar lo mueve (Llamados → `Llamado`; Solicitudes → `Buscando`). Los endpoints escriben ese nombre literal (typecast) — NO renombrar la opción sin tocar `mc-llamado.js`/`mc-waitlist.js`.
- **Instrumentación del Tablero A3 (2026-07-17, NO borrar):** campos agregados por el tablero de reporte — en **Solicitudes** y **Llamados**: `Creado` (`=CREATED_TIME()`), `Fecha primera llamada` (dateTime), `_ahora` (`=LAST_MODIFIED_TIME({Estado})`); en **Leads**: `Cuestionario iniciado` (checkbox). Los alimentan **3 automatizaciones** (*When record matches conditions*): sello de la 1ª llamada al salir de «Llamada pendiente» (una en Solicitudes, otra en Llamados → copian `_ahora` a `Fecha primera llamada`) y marca de `Cuestionario iniciado` al llegar a `Estado=quiz_iniciado`. Solo los usa el tablero; **no romperlos**. Para que el cuestionario cuente inicios, **ManyChat debe emitir el evento `quiz_iniciado`** (a `mc-evento`) al empezar el quiz (hoy `mc-match` salta directo a match/no-match).
- **Rating/puntaje de certificación: escala 1 a 7** (decisión reunión 2026-07-08; bajo 4 no se recibe). El formato de carga en Ailoo está en `…/2. Fragua/Formato_descripcion_bicicletas_Ailoo.docx`.

---

## 5. ⚠️ ERRORES COMETIDOS Y LECCIONES (NO repetir)

1. **Omni (IA de Airtable) es POCO confiable.** Se sobre-complica: agrega gráficos/páginas/filtros que NO se pidieron, **finge** lógica condicional (escribe la descripción pero no aplica la condición real), pierde páginas de formulario, duplica páginas, agrupa por el campo equivocado. → **Dale prompts pequeños, de una sola acción a la vez; verifica después de cada uno; para lógica condicional / visibilidad de campos / orden, hazlo o guíalo MANUAL.** No confíes en que Omni acertó: pide captura y revisa.
2. **Qué puede y qué no puede el API de Airtable** — ⚠️ CORREGIDO 2026-07-27, la versión vieja de esta nota era falsa y costó tiempo:
   - ✅ **SÍ crea** campos `multipleLookupValues` (lookup), `rollup`, `formula`, `count`, selects, fechas, checkboxes… (verificado creando 15 campos).
   - ✅ **SÍ crea páginas de interfaz** (`create_page`) y las publica. No hay que armarlas a mano.
   - ✅ **SÍ edita la fórmula** de un campo existente (PATCH sin cambiar su id → las automatizaciones que lo referencian siguen intactas).
   - ❌ **NO agrega ni quita opciones a un select existente** (solo `typecast:true` crea opciones al escribir un registro).
   - ❌ **NO borra campos** ni cambia el tipo de uno existente.
   - ❌ **NO toca Automatizaciones** (eso sigue siendo manual u Omni).
3. **Cloudflare bloquea scripts (error 1010/403).** Pegarle a la función en vivo (`/api/reservar`) desde python/curl da 403 por bot. → **Manda header `User-Agent` de navegador** (Mozilla/5.0…).
4. **Nombres de campo EXACTOS importan — verifica antes de diagnosticar.** Falsos diagnósticos por mismatches: `Reservas` (plural, no `Reserva`), `Precio Bici` (B mayúscula), `' Valor potencial'` (espacio inicial). → Lee el esquema real por API (`meta/bases/.../tables`) y usa el nombre literal antes de concluir que "algo falla".
5. **Repo git anidado accidental:** `C:\Users\Gabriel` es un repo git por error; `biketrust-sitio` es repo propio anidado. → **Verifica `git rev-parse --show-toplevel` antes de commitear.**
6. **Las fichas usan URLs `.html` que Cloudflare redirige 308** a URL limpia. → Al verificar con curl usa **`-L`**.
7. **Campo principal vacío = "registro sin nombre" / "Unnamed record".** El primario de Leads era `Usuario IG` (vacío en leads web) → se arregló con primario fórmula `Lead`. Lección: el campo primario debe ser siempre identificable.
8. **Fotos:** estaban dispersas (slots `Foto 1..13` vs campo `Fotos galería`). Se unificó en **`Fotos galería`** (build lo lee primero). Un solo campo de fotos.
9. **El form (alta) y la web NO ponen `Estado`** → entra vacío → una **automatización** ("Estado vacío → Borrador") lo marca. La automatización se hace en Airtable (no API).
10. **Datos de prueba:** usa SIEMPRE un campo checkbox **`DEMO`** para sembrar y luego borrar test data de un golpe (filtro `DEMO=1`). Nunca dejes basura en producción.
11. **Token pegado en chat** (el PAT). Recordar al usuario rotarlo.
12. **`NOW()` de Airtable está CACHEADO/atrasado** — llegó a sellar una hora *anterior* al `CREATED_TIME()` del mismo registro (minutos de lag). → Inútil para sellar horas en automatizaciones. Usar **`LAST_MODIFIED_TIME({Campo})`** (hora exacta del cambio de ese campo, sí se recalcula al modificarse). La fórmula de un campo **SÍ se edita por API** (PATCH a `meta/…/fields/{id}`) sin cambiar su id, así las automatizaciones que lo referencian siguen intactas.

---

## 6. Reglas de seguridad y robustez

- **Tokens nunca en el repo / nunca commiteados.** `.dev.vars`, `.env*`, `dist/`, `node_modules/`, `.claude/` están en `.gitignore`.
- **El build nunca rompe por dato faltante** → usa placeholders. Los Borradores incompletos son seguros.
- **No renombrar campos ni cambiar el contrato de datos** sin avisar (alimentan web Y el futuro funnel). Agregar campos/tablas sí está OK.
- **Verifica en vivo** lo que cambies (curl `-L`, o el dato real por API). No claimees "funciona" sin comprobar.

---

## 7. Cómo debe comportarse Claude (expectativas del usuario, según esta sesión)

- **Honestidad técnica ante todo.** Si algo NO se puede (ej. interfaces por API), dilo de frente y ofrece la alternativa real. No prometas lo imposible.
- **Verifica, no asumas.** Antes de diagnosticar un problema, comprueba el dato/esquema real por API. Varios "errores" fueron mismatches de nombre, no fallas reales.
- **Simplicidad y practicidad.** El usuario rechaza la complejidad innecesaria (ej. gráficos de "distribución por marca" con una sola marca, KPIs duplicados). Pregúntate siempre: *¿esto sirve para ESTE negocio?* (una marca, ~14 unidades premium, bajo volumen). Menos es más.
- **Paso a paso, sobre todo con Omni.** Un prompt pequeño a la vez, revisa/pide captura entre cada uno. No apiles cambios sin verificar.
- **Recomienda, no solo enumeres.** Da una opción por defecto y el porqué; no dejes al usuario eligiendo entre 5 opciones sin guía.
- **Marca proactivamente la basura/errores que encuentres** (opciones de select coladas, registros de prueba, campos duplicados) y ofrece limpiarlos — pero **no borres lo que no creaste sin avisar**.
- **Confirma antes de acciones destructivas o hacia afuera** (borrar datos, push/deploy). El usuario autoriza de a poco.
- **Usa el reparto correcto de herramientas:** datos/esquema → API directa; interfaces/forms/automatizaciones → Omni o manual guiado.
- **Verifica de verdad lo construido** (chequeos E2E por API: el usuario valora "comprobemos que todo funcione").
- **Investiga antes de proponer** cuando el usuario lo pide (buenas prácticas web) y adapta los hallazgos a su contexto comercial+técnico.

---

## 8. Pendientes / próximos pasos

> **El foco actual está en §2, con una sola fecha.** Esta sección lista únicamente lo que
> sigue vivo. Todo lo cumplido se movió a [`CHANGELOG.md`](CHANGELOG.md), que es donde vive
> la historia — no la dupliques acá.

**Del rediseño V2** (lo que bloquea el lanzamiento — detalle en `docs/V2_PLAN_MIERCOLES.md`):
1. **Horario de atención de Luis** — decisión de los dueños, pendiente. Bloquea la promesa de
   hora en el bot y el formato de `AVISO_HORARIOS` (hoy no admite el martes libre).
2. **Montar en ManyChat** las 2 puertas + duplicar ×6 la de comentarios.
3. **Crear en Airtable**: las opciones `Llamada pendiente` y `No contestado` del campo
   `Salida` (la API no agrega opciones a un select), el Kanban de Luis y la pantalla de
   Solicitudes, más las 2 plantillas nuevas de WhatsApp (`region_gestionando`,
   `llamada_no_contestada`).
4. **Env de Cloudflare — 2 faltan para el V2, 3 llevan flujos apagados.**
   *(Auditado 2026-07-28 contra el panel real. ⚠️ No deducir qué env existen leyendo el
   código: varias las creó el V1 y ninguna función nueva las referencia.)*

   Cada `FLOW_NS_*` es el **namespace del flujo de ManyChat**, así que la env no se puede
   crear antes que el flujo. Cloudflare no acepta variables vacías y **ponerles un relleno es
   PEOR que dejarlas fuera**: con un valor falso el código da la env por buena, intenta
   enviar y devuelve un error opaco de ManyChat en vez del `falta_env:X` explícito.
   **Toda env nueva exige redesplegar** — no aplican al deploy en curso.

   **Bloquean el lanzamiento V2** (esperan que se arme el flujo en ManyChat):

   | Env | Se dispara con | Plantilla |
   |---|---|---|
   | `FLOW_NS_REGION` | Kanban → Coordinación región | `region_gestionando` (por crear) |
   | `FLOW_NS_NO_CONTESTA` | Kanban → No contestado | `llamada_no_contestada` (por crear) |

   **Mientras falten, el sistema NO se rompe:** `salida-llamado` escribe igual el opt-in, la
   fecha de visita, el estado del lead, el ticket de `Solicitudes` y el `Estado` del ticket —
   lo único que no sale es el WhatsApp. Y **no estampa `Aviso salida enviado`**, así que el
   caso queda reintentable: al crear la env y redesplegar, basta sacar la tarjeta de la
   columna y volver a ponerla para que el mensaje salga.

   **Código vivo con el flujo apagado** (el endpoint corre, encuentra los leads y no manda
   nada; devuelve `no_configurado`, no error). Es deuda del V1, no una regresión — pero en el
   V2 son justo los rescates donde se fuga el lead:

   | Env | Endpoint | Mensaje que hoy NO sale |
   |---|---|---|
   | `FLOW_NS_2H` | `cron-recordatorios` | recordatorio 2 h antes de la visita (48h y 8am sí salen) |
   | `FLOW_NS_NOSHOW` | `cron-reenganche` | rescate del que no llegó a la visita |
   | `FLOW_NS_SUELTO` | `cron-reenganche` | reenganche del lead suelto (>3 días) |

   ⚠️ **`FLOW_NS_BUSCANDO` y `FLOW_NS_SOLICITUD` apuntan al MISMO flujo**
   (`content20260708161806_786788`). O sea que cuando un encargo pasa a `Buscando`,
   `cron-sourcing` le manda al staff el aviso de «nueva solicitud», no el de «pasó a
   búsqueda». No revienta nada, pero el mensaje es el equivocado: hay que crear el flujo
   propio y apuntar la env ahí.

   *Sin fallback y por eso inofensivas:* `AIRTABLE_BASE`, los `AIRTABLE_*_TABLE`,
   `BRIEFING_HOUR` y `SITE_URL` no están seteadas pero todas tienen valor por defecto en el
   código. `SITE_URL` se setea recién al conectar el dominio (punto 6).
5. **Confirmar que Luis tiene asiento con permiso de edición** en Airtable. Bloqueante.

**Deuda anterior que sigue viva:**
6. **Dominio `biketrust.cl`** → Cloudflare Pages + setear `SITE_URL` (para que OG, canonical
   y sitemap usen el dominio real).
7. **Walk-in** (venta sin lead) → form mínimo que pegue a `/api/registrar-venta`.
8. **Rotar el PAT de Airtable** (se pegó una vez en un chat) y la `MC_KEY` (en el D1 de la V2).
9. **Registrar a los 5 comentaristas que no están en el CRM** — fueron respondidos a mano en
   los comentarios pero quedaron sin seguimiento (detalle en el CHANGELOG).
10. **Limpiar inconsistencias de facturación demo** y las 2 opciones con nombre vacío del
    campo `Estado` de Leads.

> Documento maestro de diseño del funnel: `…/2. Fragua/airtable/BikeTrust_Diseno_Tecnico.docx` y la guía de Airtable en la misma carpeta.
