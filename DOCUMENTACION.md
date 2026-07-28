# Bike Trust · Documentación del sistema

> Cómo funciona el sistema de Bike Trust de punta a punta: las partes, los flujos
> de trabajo del staff y la arquitectura técnica. Idioma: español.
> Última actualización: **2026-07-27** (parche de estado; reescritura completa programada post-V2).

Índice:
1. [Visión general](#1-visión-general)
2. [Flujos operativos (para el staff)](#2-flujos-operativos-para-el-staff)
3. [Las interfaces de Airtable](#3-las-interfaces-de-airtable)
4. [Arquitectura técnica](#4-arquitectura-técnica)
5. [Pages Functions y variables de entorno](#5-pages-functions-y-variables-de-entorno)
6. [Modelo de datos](#6-modelo-de-datos)
7. [Mantenimiento](#7-mantenimiento)
8. [Pendientes / roadmap](#8-pendientes--roadmap)

---

## 1. Visión general

Bike Trust vende **bicicletas Specialized usadas, premium y certificadas** (Santiago). El sistema tiene tres frentes, y **Airtable es la única fuente de verdad** — todo lee y escribe ahí.

| Frente | Qué es | Estado |
|---|---|---|
| **Web** | Sitio estático (catálogo + ficha por bici + guías) en Cloudflare Pages. La "capa de confianza". | 🟢 En vivo: https://biketrust-sitio.pages.dev |
| **Backend / CRM** | La base Airtable: Inventario, Leads, Intereses, Reservas, Reels + interfaces para operar. | 🟢 Operativo |
| **Funnel** | Instagram + ManyChat (lo que llena el CRM con leads). V1 completa EN VIVO (P1+P2+WhatsApp, lanzada 2026-07-10; S30 = 31 leads reales). Capa conversacional **en reconstrucción V2** (intención + convergencia en agenda). Docs: **[`EMBUDO.md`](EMBUDO.md)** + **[`MANYCHAT_REBUILD.md`](MANYCHAT_REBUILD.md)**. | 🟢 V1 en vivo · 🔧 V2 |
| **Reporte (Tablero A3)** | App web privada de **solo lectura** con 3 paneles y 19 métricas, calculadas desde esta base en build time. Repo/proyecto Pages **aparte** (`biketrust-tablero`, carpeta `…/2. Fragua/tablero`). Su propio `README.md`. | 🟢 En vivo · solo lectura |

**Principio rector:** nada guarda su propia copia de los datos. El sitio se **regenera** desde Airtable en cada publicación.

---

## 2. Flujos operativos (para el staff)

### 2.1 Cargar una bici nueva (recepción en 2 partes)

El alta está pensada en **dos momentos**, porque recibir la bici y dejarla lista para publicar son tareas distintas:

**Parte 1 · Recepción inmediata** (mostrador, ~30 segundos)
1. Interfaz **Control de Inventario** → botón **"+ Nueva bici"**.
2. Llenar lo mínimo: **Marca, Modelo, Precio** (obligatorios) + talla, motorización, disciplina, año si se tienen.
3. Guardar. La bici entra en estado **`Borrador`** automáticamente → **no se publica** todavía.

**Parte 2 · Fotos y detalles** (cuando haya tiempo/fotos)
4. Interfaz **Control de Inventario** → página **"Por completar"** (lista de Borradores).
5. Completar: **fotos** (`Fotos galería`), **estado honesto**, **por qué amarla**, **specs clave**, **diagnóstico** (km/batería/ciclos en e-bikes), puntaje de certificación, etc.
6. Cambiar **`Estado` a `Disponible`**.
7. **Publicar** el sitio (ver §7) → la bici aparece online con todo completo.

> El estado `Borrador` es una **puerta de control de calidad**: evita que una bici a medio llenar (sin fotos ni diagnóstico) se publique. Es el corazón de la promesa "certificada y transparente".

### 2.2 Registrar una venta (formulario único)

Cuando un cliente compra, **una sola acción** deja sincronizadas las tres señales de venta (antes se desincronizaban → "facturación sin cierres"). ⚠️ **Desde la decisión Ailoo (2026-07-20) este camino es el fallback transitorio**: el embudo se corta en show/no-show y la venta llegará desde Ailoo (ERP central) vía integración futura. Mientras esa integración no viva, el formulario de venta sigue siendo el camino operativo (botón **"💰 Registrar venta"** en el Panel de inventario → abre `/api/registrar-venta?form=1`):

1. Elegir la **bici vendida** (lista de Disponibles/Reservadas con precio).
2. **¿Venía agendado?** → **Sí**: elegir el lead en la lista. · **No (walk-in)**: escribir nombre + teléfono (se crea el lead con `Canal origen = Tienda`).
3. **Precio efectivo de venta** (si Luis negoció; vacío = precio de lista) + **método de pago** (opcional). Quedan en el Interés Cerró y **la facturación del reporte usa el precio efectivo** cuando existe.
4. **Registrar la venta** → listo.

Cubre los dos casos (venta de lead agendado y venta de mostrador) por el **mismo flujo atómico**.

*Atajo desde la Agenda (mismo endpoint, cero divergencia):*
1. Interfaz **Agenda** → abrir la visita del lead (calendario por `Fecha visita`).
2. En el campo **`Bici comprada`**, elegir la bici que se llevó.
3. Clic en el botón **`Registrar venta`** → pestaña "✅ Venta registrada".

Eso deja, de una sola vez:
- **Lead** → `Estado = cerró` + `Fecha cierre`
- **Interés** (del par lead↔bici) → `Resultado = Cerró` (reusa el existente o crea uno)
- **Bici** → `Estado = Vendida` + `Fecha venta` (sale del catálogo en la próxima publicación)
- **Tickets del comprador** → sus `Solicitudes` y `Llamados` abiertos pasan solos a `Cerrada` (regla: una solicitud se cierra cuando el cliente COMPRA). El staff no tiene que ir a cerrar nada a mano: registrar la venta es la única acción.

> Detrás, el botón llama a la Pages Function `/api/registrar-venta` (ver §5). El reporte de facturación lee estos cierres automáticamente.

**Otros desenlaces de una visita** (se marcan a mano en `Estado` del lead): `visitó` (asistió, no compró), `no_show` (no asistió), `visita_agendada` con nueva fecha (reagendó).

### 2.3 Reservas desde la web

El cliente agenda una visita en el sitio (modal "Agenda tu visita"). Automáticamente:
- Se crea una fila en **Reservas**.
- Se hace **upsert del Lead** (busca por email o teléfono; si no existe, lo crea con `Canal origen = Web`, `Estado = visita_agendada`).
- Se crean los **Intereses** (uno por bici elegida), enlazados a la bici exacta.
- Se estampa la **`Fecha visita`** en el lead → aparece en la Agenda.

Si el guardado falla, el modal cae a **WhatsApp** con un mensaje pre-armado (no se pierde el lead).

### 2.4 Reporte del embudo (semanal / mensual / global)

1. Interfaz **Reportes** → apretar el **botón de actualizar** (llama a `/api/recalcular-embudo`).
2. Eso recalcula la tabla `Metricas` desde los Leads (embudo por etapa, por canal, KPIs y facturación), por período.
3. Elegir el **período** en el selector (semana/mes) y leer el embudo, las tasas y la facturación.

> La facturación se reconstruye desde los **cierres reales** (Intereses `Cerró` de leads cerrados), atribuida a la **semana de entrada** del lead (cohorte). Así siempre cuadra con "Cerró".

---

## 3. Las interfaces de Airtable

| Interfaz | Para qué |
|---|---|
| **Control de Inventario** | Cargar bicis, ver stock, completar Borradores ("Por completar", con textos de ayuda por campo). Páginas nuevas: **Solicitudes de búsqueda** y **Bicis ofrecidas** (colas de sourcing, cards por Estado, con formularios de carga manual) + botón **Registrar venta** (form único con precio efectivo y método de pago). |
| **Pipeline CRM** | Tablero Kanban de Leads por `Estado` (arrastrable). Clic en un lead → sus Intereses + valor potencial. |
| **Agenda** | Calendario de visitas por `Fecha visita`. Registrar el desenlace y la venta (§2.2). |
| **Reportes** | Embudo + tasas + facturación por período (semanal/mensual/global). |

> Las interfaces, formularios, Kanban, automatizaciones, lookups y rollups **se hacen a mano en Airtable** (no hay API para eso). Los datos y campos simples sí se pueden tocar por API.

---

## 4. Arquitectura técnica

```
Airtable (appQUgk8aeD752923)  ──►  build.mjs  ──►  /dist (HTML estático)  ──►  Cloudflare Pages
   (fuente de verdad)              (Node, sin deps)                              biketrust-sitio.pages.dev
        ▲                                                                              │
        │  Pages Functions (lado servidor): reservar · recalcular-embudo · registrar-venta
        └──────────────────────────────────────────────────────────────────────────────┘
```

- **Repo:** `github.com/gm-growth-partners/biketrust-sitio` (rama `main`, auto-deploy on push).
- **Repos:** `biketrust-sitio` (este) y `biketrust-tablero`, carpetas gemelas en disco.
- **Build:** `build.mjs` (Node, `fetch` nativo, sin dependencias). Lee la vista **Disponibles** de **Inventario** y genera el catálogo, una ficha por bici, la ficha técnica imprimible (PDF vía `window.print()`), y SEO (OpenGraph, sitemap, robots, favicon, 404).
- **Fotos:** el build **descarga** los adjuntos de `Fotos galería` y los **auto-hostea** en `/assets/bikes/<slug>/` (así no dependen de las URLs de Airtable, que expiran).
- **Seguridad:** el token de lectura solo vive en el build (lado servidor). El sitio público es HTML estático: nadie lee ni escribe la base desde la web.

---

## 5. Pages Functions y variables de entorno

Funciones serverless en `functions/api/` (corren en Cloudflare). Leen con `AIRTABLE_TOKEN`, escriben con `AIRTABLE_WRITE_TOKEN`.

| Función | Ruta | Qué hace | Protección |
|---|---|---|---|
| `reservar.js` | `POST /api/reservar` | Reserva web → tabla Reservas + upsert Lead + Intereses. Estampa `Fecha visita`. | — |
| `recalcular-embudo.js` | `GET/POST /api/recalcular-embudo` | Recalcula la tabla `Metricas` por período. Botón en la interfaz Reportes. | env `RECALC_KEY` (`?key=`) |
| `registrar-venta.js` | `GET/POST /api/registrar-venta` | Venta atómica: Lead cerró + Interés Cerró + Bici Vendida + fechas + **cascada de tickets** (Solicitudes/Llamados abiertos del lead → Cerrada, best-effort). Con `?form=1` sirve el **formulario de venta única** (bici + lead agendado o walk-in). También toma la bici de `Leads.Bici comprada` (botón de la Agenda). | env `VENTA_KEY` (`?key=`) |

**Variables de entorno en Cloudflare Pages:**

| Variable | Para qué |
|---|---|
| `AIRTABLE_TOKEN` | Lectura (build + functions). PAT solo `data.records:read`. |
| `AIRTABLE_WRITE_TOKEN` | Escritura (reservar / registrar-venta). PAT con `data.records:write`. |
| `RECALC_KEY` | Clave del botón de recálculo del reporte. |
| `VENTA_KEY` | Clave del botón "Registrar venta". |
| `SITE_URL` *(opcional)* | URL canónica para OG/sitemap. Setear al conectar el dominio `biketrust.cl`. |

> Las claves nunca van en el repo. El botón "Registrar venta" lleva la `VENTA_KEY` en su URL, pero la interfaz es de acceso solo-staff.

**Para desarrollo local:** hay un PAT en `.dev.vars` (gitignored) como `AIRTABLE_PAT`, con permisos de datos+esquema, para trabajar la base por API. Correr el build local: `AIRTABLE_TOKEN=<pat> node build.mjs`.

---

## 6. Modelo de datos

Base Airtable `appQUgk8aeD752923` ("Biketrust Operaciones"). **No renombrar campos sin avisar** (alimentan la web y el futuro funnel).

- **Inventario** (la bici) — primario `Etiqueta` (fórmula Marca+Modelo+Talla). Campos clave: `Estado` (`Borrador · En reacondicionamiento · Disponible · Reservada · Vendida` — solo `Disponible` se publica), Marca, Modelo, Año, Motorización, Disciplina, Talla, Precio, Precio nuevo, Puntaje certificación, `Diag · km motor`/`salud batería`/`ciclos`, Specs clave, Geometría, Estado honesto, Por qué amarla, Material cuadro, **Fotos galería**, `Fecha venta`, `Foto referencial` (muestra sello "imagen referencial" si la foto es del modelo y no de la unidad).
- **Leads** (la persona) — primario `Lead` (fórmula nombre/email). `Estado` = máquina de 13 estados. `Canal origen`, `Temperatura`, WhatsApp, Email, `Fecha primer contacto`/`última interacción`/`visita`/`cierre`, banderas de embudo, `Valor potencial` (rollup), **`Bici comprada`** (link a Inventario para la venta), **`Registrar venta`** (botón), `RecID`.
- **Intereses** (lead ↔ bici) — `Origen`, `Resultado` (`Ficha entregada/Match/No-match/Agendó/Cerró`), links Lead/Bici/Reservas, `Precio Bici` (lookup).
- **Reservas** — datos de la reserva web + links a Leads/Intereses.
- **Solicitudes** — tickets de búsqueda («Consíganmela» del bot u origen manual): Modelo buscado, Motorización, Disciplina, Talla, Presupuesto, Notas, `Estado` (`Llamada pendiente/Buscando/Conseguida/Cerrada` — NO renombrar `Llamada pendiente` sin tocar `mc-waitlist.js`/`mc-llamado.js`), Fecha, Contacto, `Origen` (`Bot DM/Manual`), link `Lead`. Es la cola de sourcing del equipo.
- **Consignaciones** — ofertas de bicicletas (rama Vender del bot u origen manual): Modelo, Año, Talla, Estado bici, Precio esperado, Contacto, Fotos, `Estado` (`Nueva/En evaluación/Compra directa/Consignación/Rechazada`), Fecha, Notas, `Origen`, link `Lead`. Al aceptarse, una automatización crea la bici en Inventario (Borrador).
- **Metricas** — capa precalculada del reporte de Airtable (una fila por dato/período, upsert por `Clave`). *(Nota: el **Tablero A3** es un reporte aparte que NO usa esta tabla — calcula desde los registros crudos en su propio build.)*
- **Instrumentación del Tablero A3** (2026-07-17, **no borrar**) — campos que llena el tablero de reporte vía automatizaciones: en **Solicitudes** y **Llamados** `Creado`, `Fecha primera llamada`, `_ahora`; en **Leads** `Cuestionario iniciado`. Detalle en `…/2. Fragua/tablero/README.md`.

> Detalle de campos y notas técnicas finas: ver `CLAUDE.md`.

---

## 7. Mantenimiento

- **Publicar cambios de datos:** cada deployment relee Airtable. Para reflejar cambios: Cloudflare Pages → Deployments → **⋯ → Retry deployment** (~1–2 min). Un `push` al repo también republica solo.
- ~~Limpiar los datos DEMO~~ ✅ hecho 2026-07-27 (17 registros de prueba eliminados, base 100% real). Pendientes reales: **rotar el PAT** de Airtable (se pegó alguna vez en un chat) y **rotar `MC_KEY`** (D1 de la V2).
- **Verificar `git rev-parse --show-toplevel`** antes de commitear: `C:\Users\Gabriel` es accidentalmente un repo git; este proyecto es un repo anidado propio.
- **Fotos nuevas:** subirlas a `Fotos galería` de la bici (el build las descarga y hostea solo).

---

## 8. Pendientes / roadmap

1. **Página "Ventas"** — historial de cierres por lead + rollups `N° compras` / `Total comprado` (recurrencia).
2. **Walk-in** — UI/form mínimo para registrar una venta sin lead previo (la Function ya lo soporta).
3. **Fotos/datos de Vado SL y Tarmac SL7** (no estaban en el sitio antiguo).
4. **Limpieza pre-producción** — datos DEMO + rotar PAT.
5. **Decisión Borrador sí/no** — a conversar con los dueños (recomendado mantenerlo, ver §2.1).
6. **Funnel ManyChat** — V1 completa en vivo (P1 + P2 + WhatsApp + briefing, lanzada 2026-07-10). **Pendiente real: la reconstrucción V2** (intención + convergencia en agenda, plan de 3 días) + mejoras chicas de código (umbral no-match del quiz, `quiz_iniciado`, hora exacta en Llamados). **Diseño y plan en [`MANYCHAT_REBUILD.md`](MANYCHAT_REBUILD.md); estado del embudo en [`EMBUDO.md`](EMBUDO.md).**

**Contrato que ManyChat deberá cumplir** (o el reporte se rompe): cada lead nace con `Fecha primer contacto`, avanza `Estado` por valores canónicos, usa `Canal origen` canónico y deduplica por `@handle`.
