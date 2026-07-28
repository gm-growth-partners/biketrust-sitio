# Bike Trust · Sitio y sistema

⚠️ **Este repo NO es solo un sitio.** Contiene el sitio estático **y** todo el backend del
embudo comercial: 15 Pages Functions que hablan con Instagram/ManyChat y escriben en Airtable,
más los crons. **El sistema está a mitad de un rediseño (V2).**

## 🧭 Por dónde empezar

| Si necesitas… | Lee |
|---|---|
| **Entender qué pasó, por qué, y qué decisiones ya están cerradas** | **[`CHANGELOG.md`](CHANGELOG.md)** ← empieza acá, son 5 minutos |
| El estado actual, modelo de datos, endpoints y errores ya cometidos | [`CLAUDE.md`](CLAUDE.md) |
| **Qué se está construyendo ahora** (rediseño V2) | [`MANYCHAT_REBUILD.md`](MANYCHAT_REBUILD.md) §0.5–0.7 y [`docs/`](docs/) |
| Solo el build y deploy del sitio estático | este README, más abajo |

> **Ojo con la documentación histórica.** [`EMBUDO.md`](EMBUDO.md) y
> [`DOCUMENTACION.md`](DOCUMENTACION.md) describen el sistema **V1**. Siguen siendo útiles
> (contratos de endpoints, modelo de datos, operación del staff) pero **su capa conversacional
> y varios estados están superados por la V2**. Léelos después del CHANGELOG, no antes, y
> ante cualquier contradicción **mandan el CHANGELOG y el código**.

## Cómo se prueba

```bash
npm test     # 3 suites, sin tocar Airtable ni producción (fetch simulado)
npm run build   # sin AIRTABLE_TOKEN → modo mock
```

---

Sitio estático generado desde Airtable (Airtable = única fuente de verdad).
El build lee la vista **Disponibles** de la tabla **Inventario** y genera un catálogo + una ficha por bici, sobre la identidad de marca. Corre en **Cloudflare Pages** desde este repo.

> El token de Airtable solo se usa en build (lado servidor). El sitio público es HTML estático: nadie puede leer ni escribir la base desde la web.

---

## Probar localmente
```bash
node build.mjs        # sin token → modo mock (usa la Kenevo de ejemplo)
```
Genera `/dist`. Abre `dist/index.html`.

---

## Puesta en marcha (una vez)

**1. Subir estos archivos al repo** (`build.mjs`, `package.json`, este README).

**2. Crear el token de Airtable (solo lectura)**
En airtable.com → cuenta → *Developer hub* → *Personal access tokens* → crear uno con:
- Scope: `data.records:read`
- Acceso: solo la base "Bike Trust · Operaciones"
Copia el token (empieza con `pat...`). **No lo pongas en el código.**

**3. Conectar Cloudflare Pages**
Cloudflare → Pages → *Create* → *Connect to Git* → este repo. Configura:
- Build command: `npm run build`
- Output directory: `dist`
- Variables de entorno:
  - `AIRTABLE_TOKEN` = el token `pat...`
  - (opcionales, ya traen default) `AIRTABLE_BASE`, `AIRTABLE_TABLE`, `AIRTABLE_VIEW`

Deploy. Listo: el sitio queda online.

**4. Republicar tras cambiar datos (manual)**
Cada deployment **relee Airtable en vivo**, así que para reflejar cualquier cambio basta con lanzar uno nuevo:
- Cloudflare Pages → tu proyecto → *Deployments* → en la última fila, menú **⋯** → **Retry deployment**.
- En ~1–2 min el sitio queda actualizado con el inventario actual.
- (Un *push* al repo también republica solo: el auto-deploy está activo.)

> Mejora futura (opcional): automatizar con un *deploy hook* de Cloudflare llamado desde una automatización de Airtable (acción *Run a script* que hace `fetch(URL, {method:'POST'})`). Así se reconstruye solo al cambiar un registro. No está activado hoy.

---

## Día a día
- **Publicar una bici:** agrégala en Inventario con `Estado = Disponible`, luego republica (paso 4). Aparece en el sitio.
- **Dar de baja:** cambia `Estado` a `Vendida` (o cualquier cosa ≠ Disponible). Sale de la vista *Disponibles*; republica (paso 4) y desaparece del sitio.

---

## Campos que lee el build (tabla Inventario)
Existentes: `Marca`, `Modelo`, `Año`, `Motorización`, `Disciplina`, `Talla`, `Precio`, `Estado`, `Puntaje certificación`, `Diag · km motor`, `Diag · salud batería`, `Diag · ciclos`, `Specs clave`, `Estado honesto`.

**A agregar** (opcionales; si faltan, salen como placeholder): `Precio nuevo` (número, para el ancla), `Rango altura` (texto), `Por qué amarla` (texto), `Referencia` (texto), `Fotos URLs` (texto).

### Formato de `Specs clave`
Texto, una cosa por línea. Líneas con `#` = título de grupo; el resto, `Etiqueta: valor`.
```
# Motor y batería
Motor: Specialized 2.1 · +410%
Batería: M2-Series · 700 Wh
# Suspensión y chasis
Horquilla: RockShox Boxxer 180 mm
```

### Fotos
Sube las fotos como **adjuntos** al campo **`Fotos galería`** de la bici (la 1ª es el héroe). El build las **descarga y auto-hostea** en `/assets/bikes/<slug>/` (no dependen de las URLs de Airtable, que expiran). Si el campo está vacío, salen los placeholders. *(El campo de texto `Fotos URLs` sigue funcionando como respaldo, pero `Fotos galería` es el camino principal.)*

### Diagnóstico
El bloque de diagnóstico (km, batería, ciclos) se muestra solo si `Motorización = Eléctrica`. En bicis musculares se oculta solo.
