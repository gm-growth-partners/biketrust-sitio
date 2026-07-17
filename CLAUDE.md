# CLAUDE.md — Bike Trust · Guía de sistema y trabajo

> Este archivo lo lee Claude Code automáticamente al iniciar sesión en este repo.
> Es la **memoria viva del proyecto**: estado, arquitectura, errores ya cometidos (para NO repetirlos) y cómo debe trabajar Claude. **Léelo completo antes de actuar.** Idioma de trabajo: **español**.
> Última actualización: **2026-07-17** (Tablero de reporte A3 desplegado y verificado).

---

## 1. Qué es el sistema

Bike Trust vende bicicletas **Specialized usadas, premium y certificadas** (Santiago, Chile). El sistema V1 tiene 3 frentes:

- **Web** (capa de confianza): sitio estático generado desde Airtable, en Cloudflare Pages.
- **Backend / CRM** (la "espina"): **Airtable es la única fuente de verdad**. Inventario, Leads, Intereses, Reservas, Reels.
- **Funnel** (Instagram + ManyChat): diseñado, **aún sin construir**. Es lo que va a *llenar* el CRM.

**Principio rector:** todo lee/escribe en Airtable. Nada guarda su propia copia.

---

## 2. Estado actual (2026-07-07)

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

**Foco actual (2026-07-08): sistema operativo completo (captación P1+P2 + sourcing + venta única). Manual de operación entregado (`…/2. Fragua/manual_operacion_biketrust.html`). Pendiente: MC_KEY (clave generada, receta lista) · limpieza de data de prueba · FAQ real · activaciones Meta (avisos al equipo, briefing, reenganche, `encargo_recibido`) · por construir: secuencia `Conseguida`→cliente (con `reactivacion_stock` ya aprobada) y aviso de reagendo del mismo día · decisión pendiente: destinatarios de los avisos (Luis/Roberto/ambos).**

⚠️ **REDISEÑO 2026-07-01 — arquitectura 100% automatizada.** El embudo se automatiza de punta a punta hasta el showroom; el humano solo cierra en tienda (y escala precio). El "cerrador humano en el agendamiento" del diseño original se reemplaza por **agenda-en-el-chat + recordatorios por WhatsApp** (Instagram no deja mandar fuera de la ventana de 24h; WhatsApp con plantillas sí). **Documento autoritativo del diseño: `…/2. Fragua/ARQUITECTURA_EMBUDO.md`** (7 etapas, dependencia dura = conectar WhatsApp Business API a ManyChat). Plan operativo día a día: `…/2. Fragua/PLAN_embudo.md`.

**Estado de fases:** Fase 1 (Puerta 1 = captura + ficha + calificación en ManyChat, con `mc-lead`/`mc-evento` en vivo) = **en curso**. Sigue: Fase 2 `/api/mc-agenda` + selector de horarios · Fase 3 WhatsApp + recordatorios · Fase 4 reenganche + Puerta 2 (quiz `/api/mc-match`).

**Pendiente inmediato (RETOMAR — pausado 2026-06-30, en segundo plano mientras se cierra el embudo):** terminar el wiring del botón de venta en la **Agenda** (probar edición inline de `Bici comprada` en vista previa; elegir botón nativo con URL+campo `RecID` o el botón-campo ya funcional; probar con DEMO antes de quitar el otro; dar permiso **Editar** al staff al compartir). Detalle completo en la memoria de Claude `project_biketrust_reporte_metricas.md`.

**Pendientes menores:** limpiar datos DEMO (flag `DEMO` en Leads/Intereses); colores en cards de inventario + botón "+ Nueva bici"; reconstruir/limpiar facturación demo; conectar dominio `biketrust.cl` (setear env `SITE_URL` en Cloudflare al hacerlo). **Env Cloudflare nuevas:** `RECALC_KEY` (reporte) y `VENTA_KEY` (registrar-venta).

---

## 3. Arquitectura y datos técnicos

- **Repo:** github.com/gm-growth-partners/biketrust-sitio (rama `main`, auto-deploy on push). Carpeta local: `C:\Users\Gabriel\Desktop\GM Growth Partners\Clientes\2. biketrust.cl\Estrategia\2. Fragua\github` (ojo: la carpeta cliente es **`2. biketrust.cl`** con prefijo numérico).
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
  - **Gotcha API (nuevo):** el GET de **un registro único** (`/Tabla/{recId}`) **NO acepta `?fields[]=`** (da 422); eso solo va en el endpoint de LISTADO. Leer el registro completo.
- **Tokens (SOLO env, NUNCA en repo):** `AIRTABLE_TOKEN` (read) y `AIRTABLE_WRITE_TOKEN` (write) en Cloudflare. Para que Claude trabaje datos/esquema por API hay un **PAT en `.dev.vars`** (gitignored) como `AIRTABLE_PAT`. **El PAT se pegó una vez en el chat — conviene rotarlo.**

### Cómo Claude trabaja Airtable
- **Datos y esquema** → directo por API (curl/python con `AIRTABLE_PAT` de `.dev.vars`).
- **Interfaces, Form views, Kanban, Automatizaciones, lookups, rollups, opciones de select** → NO hay API. Se hacen con **Omni** (la IA de Airtable) o **manual**, y **Claude guía paso a paso**.

---

## 4. Modelo de datos (lo esencial — NO renombrar campos sin avisar; alimentan web y funnel)

- **Inventario** (la bici): primario `Etiqueta` (fórmula Marca+Modelo+Talla). `Estado` (single select): `Borrador · En reacondicionamiento · Disponible · Reservada · Vendida` (solo `Disponible` se publica). Campos de ficha: Marca, Modelo, Año, Motorización, Disciplina, Talla, Precio, Precio nuevo, Puntaje certificación, Diag·(km/batería/ciclos), Specs clave, Geometría, Estado honesto, Por qué amarla, Rango altura, Material cuadro, Referencia, **Fotos galería** (campo único de fotos). Counts (rollup): Interesados, Recibió ficha, Agendaron, Cerraron. `Fecha venta`. ⚠️ Inventario **NO** tiene campo `DEMO` (solo Leads/Intereses lo tienen) — las bicis de prueba se siembran y borran **por id**.
- **Leads** (la persona): **primario `Lead`** = fórmula `IF({Nombre},{Nombre},IF({Email},{Email},IF({@handle IG},"@"&{@handle IG},"Sin nombre")))`. `Estado` = máquina de 13 estados (`nuevo → ficha_entregada / quiz_iniciado → quiz_abandonado / match_entregado / no_match → visita_agendada → visita_confirmada → no_show / visitó → cerró`; terminales `muerto`, `descartado`). `Canal origen` (opciones reales: `Comentario IG`/`DM IG`/`Quiz`/`Messenger`/`WhatsApp`/`Web`/`Tienda` — `WhatsApp` es opción colada, limpiar manual), **`@handle IG`** (usuario IG sin @, identificador de dedup del funnel — lo usan `mc-lead`/`mc-evento`), `Temperatura`, `WhatsApp`, `Email`, fechas (`Fecha primer contacto`, `Fecha última interacción`, **`Fecha visita`** dateTime, **`Fecha cierre`**), flags 1/0 (`Llegó a ficha/agendó/confirmó/visitó/cerró`), `¿Suelto?` (fórmula reenganche >3 días), `Valor potencial` (rollup SUM), `RecID` (RECORD_ID()), **`Bici comprada`** (link a Inventario, single — la bici que se llevó), **`Registrar venta`** (botón Open URL → `/api/registrar-venta`), links Intereses/Reservas, `DEMO`.
- **Intereses** (lead↔bici): primario `Interés ID` (autonumber). `Origen` (Puerta 1/Puerta 2/Web (ficha)), `Resultado` (Ficha entregada/Match/No-match/Agendó/Cerró), links Lead/Bici/Reel/Reservas, `Precio Bici` (lookup Bici→Precio), `DEMO`.
- **Reservas**: campos que escribe la web (Nombre, Email, Teléfono, Fecha, Hora, Modelos, Modelos Slug, **Bici IDs**, Origen=Web, Estado=Nueva) + links Leads/Intereses.
- **Reels**: para el funnel (sin uso aún).
- **Consignaciones** (`tblQTsCHnf8ebO2T1`, rama Vender de Puerta 2): Modelo, Año, Talla, Estado bici, Precio esperado, Contacto, Fotos, `Estado` (`Nueva/En evaluación/Aceptada/Rechazada`), Fecha, Notas, link `Lead`. La escribe `mc-consigna`.
- **Solicitudes** (`tblHnU7eHyhlbxyGM`, tickets de búsqueda «Consíganmela»): primario `Modelo buscado`, Motorización, Disciplina, Talla, Presupuesto (currency), Notas, `Estado` (`Llamada pendiente/Buscando/Conseguida/Cerrada`), Fecha, Contacto, `Origen` (`Bot DM/Manual`), link `Lead`. La escribe `mc-waitlist` (bot) y el staff por formulario (manual). Es la cola de sourcing. **Cerrada = cuando el cliente COMPRA.**
- **Llamados** (`tblgApNKo9YiqPalw`, tickets de llamado para región): primario `Nombre`, Teléfono, Ciudad, `Franja` (`Mañana/Tarde`), `Bici de interés` (link), `Estado` (`Llamada pendiente/Llamado/Cerrada`), Fecha, `Origen`, Notas, link `Lead`. La escribe `mc-llamado` (acepta `bici` recId o `reel` Post ID → `Reels.Bici`).
- **Estado "Llamada pendiente"** (renombrado desde "Nueva" 2026-07-09, en Solicitudes Y Llamados): un ticket del bot nace ahí = **Luis debe llamar**; tras llamar lo mueve (Llamados → `Llamado`; Solicitudes → `Buscando`). Los endpoints escriben ese nombre literal (typecast) — NO renombrar la opción sin tocar `mc-llamado.js`/`mc-waitlist.js`.
- **Instrumentación del Tablero A3 (2026-07-17, NO borrar):** campos agregados por el tablero de reporte — en **Solicitudes** y **Llamados**: `Creado` (`=CREATED_TIME()`), `Fecha primera llamada` (dateTime), `_ahora` (`=LAST_MODIFIED_TIME({Estado})`); en **Leads**: `Cuestionario iniciado` (checkbox). Los alimentan **3 automatizaciones** (*When record matches conditions*): sello de la 1ª llamada al salir de «Llamada pendiente» (una en Solicitudes, otra en Llamados → copian `_ahora` a `Fecha primera llamada`) y marca de `Cuestionario iniciado` al llegar a `Estado=quiz_iniciado`. Solo los usa el tablero; **no romperlos**. Para que el cuestionario cuente inicios, **ManyChat debe emitir el evento `quiz_iniciado`** (a `mc-evento`) al empezar el quiz (hoy `mc-match` salta directo a match/no-match).
- **Rating/puntaje de certificación: escala 1 a 7** (decisión reunión 2026-07-08; bajo 4 no se recibe). El formato de carga en Ailoo está en `…/2. Fragua/Formato_descripcion_bicicletas_Ailoo.docx`.

---

## 5. ⚠️ ERRORES COMETIDOS Y LECCIONES (NO repetir)

1. **Omni (IA de Airtable) es POCO confiable.** Se sobre-complica: agrega gráficos/páginas/filtros que NO se pidieron, **finge** lógica condicional (escribe la descripción pero no aplica la condición real), pierde páginas de formulario, duplica páginas, agrupa por el campo equivocado. → **Dale prompts pequeños, de una sola acción a la vez; verifica después de cada uno; para lógica condicional / visibilidad de campos / orden, hazlo o guíalo MANUAL.** No confíes en que Omni acertó: pide captura y revisa.
2. **El API de Airtable NO crea lookup ni rollup** (`UNSUPPORTED_FIELD_TYPE_FOR_CREATE`), **no cambia el tipo** de un campo, **no borra** campos, **no agrega/quita opciones de select** (solo `typecast:true` crea opciones al escribir un registro), y **no toca Interfaces/Form views/Automatizaciones**. → Eso es Omni o manual. (Ver sección 7.)
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

**0. FOCO ACTUAL (2026-07-01, pedido de los dueños): cerrar el embudo ManyChat al 100%, todo lo demás en segundo plano.**
   - Día 3 (contrato + `/api/mc-lead` + `/api/mc-evento`) ✅ CERRADO, ver `PLAN_embudo.md`.
   - **Siguiente: Día 4 — Puerta 1.** En ManyChat (ya conectado a IG/Meta Business): trigger de comentario/DM en un reel "Ficha-modelo" → responde por DM con la ficha (imagen+link de la bici) → **External Request** POST a `/api/mc-lead` (`handle`, `canal="Comentario IG"` o `"DM IG"`) y luego a `/api/mc-evento` (`lead` o `handle`, `estado="ficha_entregada"`, `origen="Puerta 1 (reel/comentario)"`, `resultado="Ficha entregada"`, `reel`=Post ID Instagram del reel comentado — el endpoint resuelve la bici solo vía `Reels.Bici`). Falta: crear el registro en `Reels` por cada reel real (Post ID + Tipo=Ficha-modelo + link a la bici) y armar el flujo visual en ManyChat.
   - ✅ `MC_KEY` seteada (2026-07-09): los 7 puentes protegidos, 401 sin key verificado.

1. **TERMINAR botón de venta en la Agenda (RETOMAR, pausado 2026-06-30):** probar edición inline de `Bici comprada` en la vista previa; elegir botón nativo (URL + campo `RecID`) o el botón-campo ya funcional; probar con DEMO antes de quitar el otro; dar permiso **Editar** al staff al compartir. (Detalle: memoria de Claude `project_biketrust_reporte_metricas.md`.)
2. **Limpiar datos DEMO** (Leads + Intereses con `DEMO=1`) cuando se confirme producción; limpiar inconsistencias de facturación demo.
3. **Pulidos menores:** colores de cards + botón "+ Nueva bici" en inventario; páginas Ventas (Intereses Cerró por lead + rollups `N° compras`/`Total comprado`).
4. **Dominio `biketrust.cl`** → Cloudflare Pages + setear env `SITE_URL` (para que OG/canonical/sitemap usen el dominio real).
5. **Walk-in** (venta sin lead) → UI/form mínima que pegue a `/api/registrar-venta` (POST).
6. **Aviso diario al staff** (fase ManyChat): cada mañana ~8-9 AM, mensaje con las visitas de HOY (leads con `Fecha visita`=hoy).
7. **Funnel ManyChat** (fase grande, desbloqueada): Puerta 1 (reel→ficha por DM), Puerta 2 (quiz), flujo central ManyChat↔Airtable (upsert por handle IG — agregar campo texto para el `@handle` e incluirlo en la fórmula del primario `Lead`), reenganche diario de sueltos, medición/pixel, imagen de ficha para el DM. Requiere ManyChat Pro + Meta Business. **Contrato que ManyChat debe cumplir** (o el reporte no funciona): cada lead nace con `Fecha primer contacto`, avanza `Estado` por valores canónicos, usa `Canal origen` canónico, deduplica por @handle.

> Documento maestro de diseño del funnel: `…/2. Fragua/airtable/BikeTrust_Diseno_Tecnico.docx` y la guía de Airtable en la misma carpeta.
