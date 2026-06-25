# CLAUDE.md — Bike Trust · Guía de sistema y trabajo

> Este archivo lo lee Claude Code automáticamente al iniciar sesión en este repo.
> Es la **memoria viva del proyecto**: estado, arquitectura, errores ya cometidos (para NO repetirlos) y cómo debe trabajar Claude. **Léelo completo antes de actuar.** Idioma de trabajo: **español**.
> Última actualización: **2026-06-25**.

---

## 1. Qué es el sistema

Bike Trust vende bicicletas **Specialized usadas, premium y certificadas** (Santiago, Chile). El sistema V1 tiene 3 frentes:

- **Web** (capa de confianza): sitio estático generado desde Airtable, en Cloudflare Pages.
- **Backend / CRM** (la "espina"): **Airtable es la única fuente de verdad**. Inventario, Leads, Intereses, Reservas, Reels.
- **Funnel** (Instagram + ManyChat): diseñado, **aún sin construir**. Es lo que va a *llenar* el CRM.

**Principio rector:** todo lee/escribe en Airtable. Nada guarda su propia copia.

---

## 2. Estado actual (2026-06-25)

| Frente | Estado |
|---|---|
| 🟢 **Web** | EN VIVO (https://biketrust-sitio.pages.dev). Catálogo, fichas e-commerce, reservas, guías, SEO (OG/sitemap/robots/favicon/404), **ficha técnica PDF auto-generada**. |
| 🟢 **Backend/CRM** | OPERATIVO y verificado E2E. Inventario + Leads + Intereses + Reservas. Reserva web→Lead+Intereses automático. |
| 🟢 **Interfaces Airtable** | 3 construidas: **Control de Inventario** (form alta + panel + por completar), **Pipeline CRM** (Kanban), **Reporte de los lunes** (embudo/medición). |
| 🔴 **Funnel ManyChat** | Diseñado, sin construir. Desbloqueado (ya hay acceso IG). Falta ManyChat Pro + Meta Business. |

**Pendientes menores:** limpiar datos DEMO (flag `DEMO` en Leads/Intereses); quitar 3 filtros de página en "Reporte de los lunes"; colores en cards de inventario + botón "+ Nueva bici"; conectar dominio `biketrust.cl` (falta setear env `SITE_URL` en Cloudflare al hacerlo).

---

## 3. Arquitectura y datos técnicos

- **Repo:** github.com/gm-growth-partners/biketrust-sitio (rama `main`, auto-deploy on push). Carpeta local: `C:\Users\Gabriel\Desktop\GM Growth Partners\Clientes\biketrust.cl\Estrategia\2. Fragua\github`.
- **Build:** `build.mjs` (Node, sin dependencias, `fetch` nativo). Lee la vista **Disponibles** de **Inventario** y genera `/dist` (catálogo + ficha por bici + ficha técnica imprimible + SEO).
- **Airtable:** base `appQUgk8aeD752923` ("Biketrust Operaciones").
- **Pages Function:** `functions/api/reservar.js` — recibe la reserva web, la escribe en Reservas y **hace upsert de Lead + crea Intereses** (best-effort). Lee con `AIRTABLE_TOKEN`, escribe con `AIRTABLE_WRITE_TOKEN`.
- **Tokens (SOLO env, NUNCA en repo):** `AIRTABLE_TOKEN` (read) y `AIRTABLE_WRITE_TOKEN` (write) en Cloudflare. Para que Claude trabaje datos/esquema por API hay un **PAT en `.dev.vars`** (gitignored) como `AIRTABLE_PAT`. **El PAT se pegó una vez en el chat — conviene rotarlo.**

### Cómo Claude trabaja Airtable
- **Datos y esquema** → directo por API (curl/python con `AIRTABLE_PAT` de `.dev.vars`).
- **Interfaces, Form views, Kanban, Automatizaciones, lookups, rollups, opciones de select** → NO hay API. Se hacen con **Omni** (la IA de Airtable) o **manual**, y **Claude guía paso a paso**.

---

## 4. Modelo de datos (lo esencial — NO renombrar campos sin avisar; alimentan web y funnel)

- **Inventario** (la bici): primario `Etiqueta` (fórmula Marca+Modelo+Talla). `Estado` (single select): `Borrador · En reacondicionamiento · Disponible · Reservada · Vendida` (solo `Disponible` se publica). Campos de ficha: Marca, Modelo, Año, Motorización, Disciplina, Talla, Precio, Precio nuevo, Puntaje certificación, Diag·(km/batería/ciclos), Specs clave, Geometría, Estado honesto, Por qué amarla, Rango altura, Material cuadro, Referencia, **Fotos galería** (campo único de fotos). Counts (rollup): Interesados, Recibió ficha, Agendaron, Cerraron. `Fecha venta`, `DEMO`.
- **Leads** (la persona): **primario `Lead`** = fórmula `IF({Nombre},{Nombre},IF({Email},{Email},"Sin nombre"))`. `Estado` = máquina de 12 estados (`nuevo → ficha_entregada / quiz_iniciado → quiz_abandonado / match_entregado / no_match → visita_agendada → visita_confirmada → visitó → cerró`; terminales `muerto`, `descartado`). `Canal origen`, `Temperatura`, `WhatsApp`, `Email`, fechas, flags 1/0 (`Llegó a ficha/agendó/visitó/cerró`), `¿Suelto?` (fórmula reenganche >3 días), `Valor potencial` (rollup SUM), links Intereses/Reservas, `DEMO`.
- **Intereses** (lead↔bici): primario `Interés ID` (autonumber). `Origen` (Puerta 1/Puerta 2/Web (ficha)), `Resultado` (Ficha entregada/Match/No-match/Agendó/Cerró), links Lead/Bici/Reel/Reservas, `Precio Bici` (lookup Bici→Precio), `DEMO`.
- **Reservas**: campos que escribe la web (Nombre, Email, Teléfono, Fecha, Hora, Modelos, Modelos Slug, **Bici IDs**, Origen=Web, Estado=Nueva) + links Leads/Intereses.
- **Reels**: para el funnel (sin uso aún).

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

1. **Limpiar datos DEMO** (Leads + Intereses con `DEMO=1`) cuando se confirme producción.
2. **Pulidos menores:** quitar filtros de página en "Reporte de los lunes"; colores de cards + botón "+ Nueva bici" en inventario.
3. **Dominio `biketrust.cl`** → Cloudflare Pages + setear env `SITE_URL` (para que OG/canonical/sitemap usen el dominio real).
4. **Funnel ManyChat** (fase grande, desbloqueada): Puerta 1 (reel→ficha por DM), Puerta 2 (quiz), flujo central ManyChat↔Airtable (upsert por handle IG — agregar campo texto para el `@handle` e incluirlo en la fórmula del primario `Lead`), reenganche diario de sueltos, medición/pixel, imagen de ficha para el DM. Requiere ManyChat Pro + Meta Business.

> Documento maestro de diseño del funnel: `…/2. Fragua/airtable/BikeTrust_Diseno_Tecnico.docx` y la guía de Airtable en la misma carpeta.
