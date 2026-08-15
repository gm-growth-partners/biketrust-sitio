# Montaje · WhatsApp entrante (Puertas 3 y 4)

> **Cuenta ManyChat:** `fb5169713` · canal WhatsApp **ya conectado** (verificado 2026-08-15).
> Todas las Solicitudes externas son `POST`, `Content-Type: application/json`, con la misma
> `MC_KEY` que ya usan las del DM.
>
> ⚠️ El SVG `flujo_whatsapp_entrante.svg` dibuja una versión **anterior y descartada** de
> esta arquitectura. Sirve para ver los 4 botones del sitio, nada más. Manda este documento.

---

## 0 · El principio

**El sitio no necesita un embudo propio: entra al que ya existe.** La cascada del DM
(`mc-clasifica` → `R-1..R-12`) ya resuelve el problema difícil, que es qué hacer con un
mensaje cualquiera.

Y de ahí sale la regla que gobierna todo lo demás:

> **Solo se justifica un atajo cuando aportamos información que el clasificador NO puede
> deducir del texto.**

| Botón del sitio | ¿Atajo? | Por qué |
|---|---|---|
| **Ficha de una bici** | **SÍ** → `MODELO` + la bici | traemos la **referencia exacta**; el clasificador solo podría adivinar el modelo por su nombre |
| **Consignación** | **SÍ** → `VENDER` | intención explícita e inequívoca |
| **Encargo** | **NO** | el texto ya trae el modelo elegido en el formulario; `mc-clasifica` devuelve `MODELO` o `BICI_SUELTA` según corresponda |
| **WhatsApp general** | **NO** | sin criterios en el texto → el clasificador dice `BICI_SUELTA`, que es lo correcto |

🔴 **Por qué encargo y general NO se atajan.** Forzarlos a `ASESORIA` (el quiz) manda al
cuestionario a alguien que **acaba de llenar un formulario en el sitio** con modelo, talla y
presupuesto. Le vuelve a preguntar lo que ya respondió. El atajo ahí no agrega información:
la quita.

**Lo único que necesitan encargo y general es que su Lead quede con `Canal origen = Web`**,
para que cuenten en la Puerta 3. Eso se resuelve con un campo, no con una rama.

---

## 1 · Lo que el diseño ya resuelve — no reinventarlo

Antes de agregar cualquier bloque, estos ya existen en la cascada y cubren los casos:

| Bloque | Qué es | Cuándo se usa |
|---|---|---|
| **`BICI_SUELTA`** | «quiere una bici pero no dice cuál» — ofrece escribir el nombre, *Ayúdenme a elegir* (quiz) o *Que me llamen mejor* (B4) | el general del sitio cae acá vía clasificador |
| **`NM`** | la salida honesta del quiz: *«de lo que tengo HOY ninguna calza… si sabes lo que buscas, te la conseguimos»* → *Sí, que me llamen* | **es el encargo**, y también el destino de una bici vendida |
| **Grupo A (`MODELO`)** | 54 % del tráfico: resuelve la bici y entrega la ficha rica | la ficha del sitio entra acá |
| **`E-1`** | guarda de `cf_modo_humano` | **toda** entrada pasa por acá |
| **`B4`** | captura del teléfono → `mc-llamado` | convergencia final |

---

## 2 · Campos

Configuración → Campos → Nuevo campo de usuario, todos **Texto**:

```
cf_web_msg      cf_web_canal     cf_web_bici_id   cf_web_modelo
cf_web_precio   cf_web_puntaje   cf_web_ficha_url cf_web_disponible
```

`cf_web_ref` ya no hace falta: `mc-bici` extrae la referencia del mensaje completo.

⚠️ `cf_intencion`, `cf_modelo_buscado`, `cf_telefono` y `cf_ciudad` **ya existen** del DM.
No los dupliques: el atajo escribe en los MISMOS campos que lee la cascada.

---

## 3 · La arquitectura

```
Mensaje entrante por WhatsApp
        ↓
 [A] Acciones · guardar y limpiar
        ↓
 [B] ¿contiene alguno de los 4 textos del sitio?   (una condición, con OR)
        Sí → cf_web_canal = Web
        ↓
 [C] ¿es la de la ficha?
        Sí → mc-bici → ¿disponible?
                 sí → cf_intencion = MODELO  ─┐
                 no → NM (salida honesta)      │
        ↓                                      │
 [D] ¿es la de consignación?                   │
        Sí → cf_intencion = VENDER  ───────────┤
        ↓                                      │
     (encargo · general · texto libre:         │
      cf_intencion queda VACÍO)  ──────────────┤
                                               ↓
                                             E-1
                                               ↓
                              … guardas … → ¿cf_intencion vacío?
                                       sí → mc-clasifica → R-1
                                       no → R-1 directo
```

**Tres condiciones, no cinco.** Y ninguna decisión inventada.

### [A] · Acciones — guardar y limpiar

- `cf_web_msg` = variable **Last Text Input** (botón `{}`)
- `cf_web_canal` = `WhatsApp` ← valor por defecto
- **BORRAR** `cf_intencion`
- **BORRAR** `cf_modelo_buscado`

🔴 **El borrado no es opcional.** Sin él, alguien que ya conversó antes llega con la
intención de la vez pasada; la condición «`cf_intencion` vacío» la ve llena, se salta el
clasificador, y lo rutea por lo que quiso la semana pasada. Le pasa **solo a los que
vuelven** —la gente que más importa— y es invisible: el flujo no falla, contesta cualquier
cosa. La cascada de DM hace lo mismo en su bloque A-2 por esta misma razón.

⚠️ El canal por defecto tampoco es opcional: un `canal` vacío llega a `mc-lead` con
`typecast` y **crea una opción en blanco** en `Canal origen`. Ya hay dos de esas de deuda.

### [B] · ¿Viene del sitio?

**UNA** condición sobre `cf_web_msg`, operador **contiene**, con las cuatro en **OR**:

```
ficha certificada de la Specialized
```
```
Quiero encargar una Specialized
```
```
Quiero consignar mi Specialized
```
```
Busco una Specialized usada certificada
```

**Sí** → Acciones: `cf_web_canal` = `Web`. **No** → sigue con el valor por defecto.

Los cuatro fragmentos están verificados contra el sitio en producción, son estables (no
cambian por bici ni por formulario) y **ninguno lleva tilde**, a propósito: un problema de
codificación no puede romperlos.

Su única función es la atribución. El ruteo se decide más abajo.

### [C] · La ficha

Condición sobre `cf_web_msg` **contiene** `ficha certificada de la Specialized`.

**Solicitud externa:**

```
POST https://biketrust-sitio.pages.dev/api/mc-bici?key=<MC_KEY>
{ "texto": "{{cf_web_msg}}" }
```

Se le manda el **mensaje completo**: ManyChat no tiene funciones de texto ni regex, así que
no puede recortar `4082552` de `(ref 4082552)`. El endpoint lo extrae.

**Mapeo de la respuesta:**

| Respuesta | Campo de ManyChat |
|---|---|
| `bici` | `cf_web_bici_id` |
| `modelo` | **`cf_modelo_buscado`** ← el que lee la cascada |
| `modelo` | `cf_web_modelo` |
| `precio_texto` | `cf_web_precio` |
| `puntaje` | `cf_web_puntaje` |
| `ficha_url` | `cf_web_ficha_url` |
| `disponible` | `cf_web_disponible` |

**Guarda de disponibilidad** — condición `cf_web_disponible` es `true`:

- **Sí** → Acciones: `cf_intencion` = `MODELO` → **E-1**
- **No** → **NM**, la salida honesta que ya existe

🔴 Sin esa guarda alguien recibe la ficha de una bici vendida. Y el destino del «no» es
**NM y no el quiz**: NM ya dice *«de lo que tengo hoy ninguna calza… te la conseguimos»* con
el copy trabajado, que es exactamente la situación.

### [D] · La consignación

Condición sobre `cf_web_msg` **contiene** `Quiero consignar mi Specialized`
→ Acciones: `cf_intencion` = `VENDER` → **E-1**.

### El resto

Encargo, general y cualquier texto libre **no tocan `cf_intencion`**: llegan a E-1 con el
campo vacío y el clasificador los rutea. Es su trabajo.

---

## 4 · Dentro de la cascada duplicada

### 4.1 · La condición que protege el atajo 🔴

Justo **antes** de la Solicitud externa a `mc-clasifica`, una **Condición**:

```
cf_intencion está vacío
```

- **Vacío** → `mc-clasifica` → `R-1`
- **Con valor** → **`R-1` directo**

Sin esto, las ramas del sitio pasan por el clasificador y **se les pisa la intención** que
acabamos de resolver — incluida la bici exacta de la ficha. Todo el atajo se pierde.

### 4.2 · Entrar por E-1, nunca por R-1

Las tres salidas convergen en **E-1**, no en R-1. E-1 es el guarda de `cf_modo_humano`:
si Luis está conversando a mano con esa persona, impide que el bot se le meta encima.

### 4.3 · El identificador, en las 11 Solicitudes externas

```json
{ "subscriber_id": "{{user_id}}", ... }
```

⚠️ **En WhatsApp NO existe `{{ig_username}}`.** Los diez endpoints aceptan `subscriber_id`.

### 4.4 · El canal, en todos los `mc-lead`

```json
{ "subscriber_id": "{{user_id}}", "canal": "{{cf_web_canal}}" }
```

🔴 **No lo fijes en `Web`.** A-1 lo usan dos caminos: el atajo de la ficha **y** quien
escribe libre y cae en `MODELO`. Con `Web` fijo marcarías como venido del sitio a alguien
que nunca lo vio — y `Canal origen` se sella una sola vez.

### 4.5 · Los dos sellos que faltaban

Hacen visible la cadena de la Puerta 3 en el tablero.

**Después del bloque que manda la ficha rica:**

```
POST https://biketrust-sitio.pages.dev/api/mc-evento?key=<MC_KEY>
{ "subscriber_id": "{{user_id}}", "estado": "ficha_entregada",
  "resultado": "Ficha entregada", "origen": "Web (ficha)", "bici": "{{cf_web_bici_id}}" }
```

**En la rama del «sí» de la oferta de llamada (B3), ANTES de pedir el teléfono:**

```
POST https://biketrust-sitio.pages.dev/api/mc-acepta?key=<MC_KEY>
{ "subscriber_id": "{{user_id}}" }
```

⚠️ **En ese orden.** Si se sella después de pedir el número, quien acepta y no lo deja
desaparece — y esa es justamente la fuga que se quiere medir.

---

## 5 · Lo que rompió la conversión de canal

- **`{{ig_username}}` dentro de los mensajes**, no solo en las Solicitudes: en WhatsApp sale
  vacío. Reemplazar por `{{first_name}}`.
- **Botones**: WhatsApp permite **máximo 3** por mensaje, **20 caracteres** cada uno. Un
  bloque con 4+ botones no se envía. *(El diseño del DM ya respeta este límite: los copys
  anotan los chars de cada botón.)*
- **Galerías y tarjetas** de Instagram: convertir a texto con enlace.
- **La entrada de teléfono**: dejar activado «Guardar como ID de WhatsApp».
- **El AI Step suelto** en el lienzo: confirmar que **no tenga ningún cable de entrada**.
  Nunca finaliza (bug conocido) y mata el flujo en silencio.

---

## 6 · Prueba de humo — antes de publicar

Usa **Vista previa**, que corre el flujo sin ponerlo en vivo.

| Camino | Qué debe pasar |
|---|---|
| Sitio → botón de ficha | Lead `Canal origen = Web` · Interés `Ficha entregada` + bici enlazada · ticket en `Llamados` |
| Sitio → botón de encargo | Lead `Canal origen = Web` · ruteado por el clasificador, **sin** pasar por el quiz si nombró modelo |
| Otro número → texto libre | Lead `Canal origen = WhatsApp` · ruteado por `mc-clasifica` |
| Ficha de una bici **vendida** | NO se manda la ficha; cae en NM |

⚠️ **Tu propio contacto no sirve para validar la Puerta 3**: ya existe como `DM IG` (el
origen no se pisa) y está marcado `DEMO` (el embudo los excluye). Para ver números en el
tablero hace falta un teléfono que no esté en el CRM.

Al terminar, marcar `DEMO` en **Leads e Intereses** — marcarlo en el Lead **no se propaga**.

---

## 7 · Lo que NO hay que hacer

- **No construir una cascada paralela.** Dos cerebros para el mismo problema se
  desincronizan en semanas.
- **No atajar lo que el clasificador ya resuelve.** Un atajo sin información nueva es
  precisión perdida y flujo de más que mantener.
- **No inventar destinos.** Antes de conectar una salida a algo, buscar si el diseño ya
  tiene un bloque para ese caso — `BICI_SUELTA` y `NM` cubren más de lo que parece.
- **No borrar la rama `else`** de la cascada: sin ella, un valor inesperado mata el flujo en
  silencio, sin mensaje, sin Lead y sin métrica.
