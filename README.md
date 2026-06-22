# Bike Trust · Sitio

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

**4. Republicación automática al cambiar datos**
- Cloudflare Pages → tu proyecto → *Settings* → *Deploy hooks* → crea uno → copia la URL.
- Airtable → tabla Inventario → *Automations* → *When record matches conditions* (o *updated*) → acción *Run script* o *Send webhook* → pega la URL del deploy hook.
- Cada vez que agregues, edites o marques una bici como vendida, Airtable llama al hook y el sitio se reconstruye solo (1–2 min).

---

## Día a día
- **Publicar una bici:** agrégala en Inventario con `Estado = Disponible`. Aparece sola.
- **Dar de baja:** cambia `Estado` a `Vendida` (o cualquier cosa ≠ Disponible). Sale de la vista *Disponibles* → desaparece del sitio en el siguiente build.

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

### Fotos (por ahora)
Pega URLs permanentes en `Fotos URLs`, separadas por coma o salto de línea (la 1ª es el héroe). Si está vacío, salen los placeholders. *(Próxima iteración: importar automáticamente las fotos adjuntas en Airtable — lo armamos cuando lleguen las fotos.)*

### Diagnóstico
El bloque de diagnóstico (km, batería, ciclos) se muestra solo si `Motorización = Eléctrica`. En bicis musculares se oculta solo.
