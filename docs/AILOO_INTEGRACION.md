# Puente Ailoo → Inventario · hoja as-built

> **Qué es esto.** Ailoo es el ERP de Bike Trust: ahí Luis carga cada bicicleta y ahí se
> factura. Hasta ahora los datos de la ficha (talla real, puntaje, diagnóstico, componentes,
> estado honesto) vivían dentro del campo *Descripción* como texto corrido, y Gabriel los
> volvía a digitar a mano en Airtable. Este puente elimina esa segunda digitación.
>
> **El requerimiento que se le mandó a Ailoo** está en
> `…/2. Fragua/Requerimiento_tecnico_Ailoo.docx`. Ese documento es **el contrato con un
> tercero**: los nombres de las claves del JSON y los códigos de respuesta están publicados
> y hay gente implementando contra ellos. No cambiarlos sin avisarles.

Estado: **código escrito, probado y verificado E2E contra Airtable — falta desplegar y
setear dos env.** Ver §5.

---

## 1. El circuito

```
Luis carga/edita la bici en Ailoo
        │  POST JSON (campos estructurados)
        ▼
/api/ailoo-bici          ← upsert por «Referencia» (idempotente)
        │
        ├─► Airtable · Inventario   (campos ya compuestos, listos para publicar)
        ├─► fotos: descarga + uploadAttachment   ⟵ asíncrono (waitUntil)
        └─► Deploy Hook de Cloudflare            ⟵ asíncrono: el sitio se reconstruye
                    │
                    ▼
        sitio + ficha imprimible + el bot ya puede ofrecerla
```

## 2. La decisión de diseño que hay que entender antes de tocar nada

**Ailoo manda datos planos; nosotros componemos los strings con formato.**

Tres campos de Airtable no son datos sueltos sino texto con estructura, y esa estructura la
leen `build.mjs` y `mc-match.js`:

| Campo Airtable | Formato que espera | Quién lo arma | Lo lee |
|---|---|---|---|
| `Rango altura` | `178 a 188 cm` | nosotros, desde `altura_min_cm`/`altura_max_cm` | `parseRangoAltura` (mc-match, recomendación por estatura) |
| `Desglose puntaje` | `Área: 6.8/7` por línea | nosotros, desde las 6 `nota_*` | `desgloseRow` (build.mjs, barras de la tarjeta) |
| `Specs clave` | bloques `# Grupo` + `Etiqueta: valor` | nosotros, desde `componentes` y `mejoras` | `parseSpecs` (build.mjs, pestaña Componentes y ficha imprimible) |

Si le hubiéramos pedido a Ailoo que respetara esos formatos, volvíamos a depender de
digitación perfecta —que es justo el problema que se está resolviendo—. Al pedir números
sueltos y una línea por ítem, **el contrato con Airtable no cambia en nada** y el formulario
de Luis queda a prueba de tipeo.

⚠️ **Por eso `test/ailoo-bici.mjs` extrae los parsers reales de `build.mjs` y `mc-match.js`
y les pasa lo que componemos.** Si alguien toca `parseSpecs`, `desgloseRow` o
`parseRangoAltura`, ese test cae y avisa antes de que se rompa una ficha en producción.

## 3. Reglas que no son obvias

- **`Referencia` es la llave.** Número de 7 dígitos, único **por unidad** (no por modelo),
  que Ailoo ya genera y publica. Reenviar el mismo payload actualiza en vez de duplicar, así
  que reintentar siempre es seguro. Cruzar por referencia, **nunca por nombre**: los nombres
  de Ailoo son inconsistentes («Vado SL» vs «Vado Sl») y dos unidades del mismo modelo se ven
  idénticas.
- **Orden del desglose.** La tarjeta del catálogo dibuja como barras solo las **cuatro
  primeras** filas (`build.mjs` → `bars: b.desglose.slice(0,4)`). Por eso en una e-bike
  «Motor y batería» va **segundo**: es lo que el comprador quiere ver.
- **`Diag · salud batería` es de tipo *percent***: guarda la **fracción** (`0.92`) y el build
  multiplica por 100. Ailoo manda el entero `92`.
- **El estado nunca pisa una `Reservada`.** Esa la pone el equipo con una seña de por medio.
  El stock solo mueve dos transiciones: `stock 0 → Vendida` (+ sella `Fecha venta`) y
  `stock ≥ 1 → Disponible` **solo si** venía de `Vendida`, `Borrador` o
  `En reacondicionamiento`. Si el envío no trae `stock`, el estado no se toca.
- **Las fotos solo se ingieren si la galería está VACÍA.** Varias bicis tienen fotos curadas
  a mano; una actualización de precio desde Ailoo no puede borrarlas.
- **Airtable no puede bajar las fotos por URL** desde el CDN de Ailoo: su fetcher server-side
  queda bloqueado y el campo queda vacío **en silencio**. Hay que bajar el binario con
  User-Agent de navegador y subirlo por `uploadAttachment`. Por eso las fotos van en
  `waitUntil`: no caben en los 3 segundos de respuesta que se le prometieron a Ailoo.
- **Diagnóstico en una bici muscular se ignora** y se devuelve un aviso, en vez de ensuciar
  la ficha con un dato imposible.

## 4. Contrato (resumen; el detalle está en el .docx, secciones 2 y 4)

| | |
|---|---|
| **URL** | `POST /api/ailoo-bici` |
| **Auth** | `?key=…` o cabecera `X-API-Key`, contra la env `AILOO_KEY` |
| **Obligatorio** | `referencia` |
| **Prueba** | `?dry=1` → devuelve el mapeo completo y **no escribe nada** |
| **Ficha** | `GET /api/ailoo-bici` → describe el endpoint (para confirmar que la URL está viva) |

Respuestas: `200 {ok, accion:'creada'|'actualizada', id}` · `400 falta_referencia` /
`json_invalido` (no reintentar) · `401 clave_invalida` (no reintentar) · `502`/`503`
(reintentar 1, 5 y 25 min).

## 5. Lo que falta para que esté vivo

1. **Desplegar** (push a `main` → auto-deploy de Cloudflare Pages).
2. **Env `AILOO_KEY`** en Cloudflare. ⚠️ Sin ella el endpoint queda **abierto** —sigue el
   criterio de los puentes `mc-*`— y lo grita en cada respuesta (`aviso_seguridad`) y en el
   GET. **Setearla antes de entregarle la URL a Ailoo.**
3. **Env `DEPLOY_HOOK_URL`** en Cloudflare (Pages → Settings → Builds & deployments →
   Deploy hooks → crear uno para `main`). Sin ella todo funciona igual, pero el sitio no se
   reconstruye solo: la bici queda en Airtable esperando el próximo despliegue. **Es la pieza
   que hace que el circuito no dependa de nadie.**

Toda env nueva **exige redesplegar**: no aplica al despliegue en curso.

## 6. Verificación hecha (2026-08-13)

- `npm test` → suite completa en verde (226 asserts), incluido `test/ailoo-bici.mjs`
  (47 asserts: mapeo, ida y vuelta contra los parsers reales, estados y contrato de respuestas).
- **E2E contra Airtable de producción**, con una bici sembrada (`Referencia ZZ-TEST-AILOO`) y
  borrada por id al terminar: alta con estado y campos correctos · reenvío idéntico que
  actualiza sin duplicar · cambio de precio · `stock 0 → Vendida` con `Fecha venta` sellada ·
  `Reservada` respetada · `401` con clave equivocada. Limpieza confirmada: 0 registros.
- **Campo `Color` creado** en Inventario (`fldM4X0iqZY22BeZp`, singleLineText): Ailoo ya lo
  tiene en su ficha y no había dónde recibirlo.

## 7. Segunda etapa (no está construida ni pedida)

La venta registrada en Ailoo viajando con el **teléfono del comprador**, para cerrar la
trazabilidad entre quien consultó por Instagram y la venta efectiva. Se mencionó en la
reunión con los dueños del 2026-07-20 y quedó **fuera** del requerimiento enviado.
