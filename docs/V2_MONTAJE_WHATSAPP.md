# Montaje · WhatsApp entrante (Puertas 3 y 4)

> Diagrama: [`flujo_whatsapp_entrante.svg`](flujo_whatsapp_entrante.svg) — ⚠️ el SVG dibuja
> el diseño VIEJO, de cascada propia. Vale como referencia de los 4 botones del sitio, no
> de la arquitectura. Manda este documento.
>
> **Cuenta ManyChat:** `fb5169713` · canal WhatsApp **ya conectado** (verificado 2026-08-15).
> Todas las Solicitudes externas son `POST`, `Content-Type: application/json`, y llevan la
> misma `MC_KEY` que ya usan las del DM.

---

## 0. La idea, en una frase

**El sitio no necesita un embudo propio: necesita entrar al que ya existe con la intención
ya resuelta.**

La puerta de DM ya resuelve el problema difícil —qué hacer con un mensaje cualquiera— con
`mc-clasifica` y la cascada `R-1..R-12`. Un mensaje que llega del sitio trae el texto
prellenado, así que **ya sabemos la intención sin clasificar nada**. Es un atajo, no una
excepción.

```
Mensaje entrante por WhatsApp
        │
        ├─ ¿el texto es de uno de los 4 botones del sitio?
        │       SÍ → se setea cf_intencion directo (se salta el clasificador)
        │       NO → mc-clasifica  ──→ cf_intencion
        │
        └──────────────→ R-1 .. R-12   ← LA MISMA CASCADA DEL DM
```

⚠️ **Esto NO se construye de cero.** Se **duplica la automatización de DM**, se **convierte
al canal WhatsApp** (ambas opciones están en el menú «⋮» de la automatización) y se le
antepone el atajo del sitio. Construir una cascada paralela sería mantener dos cerebros
para el mismo problema.

**De paso resuelve la Puerta 4.** Cualquiera que escriba libre —QR en tienda, boca a boca—
entra por `mc-clasifica` igual que en el DM. Esa puerta deja de estar «en construcción».

---

## 1. Los campos

Configuración → Campos → Nuevo campo de usuario, todos **Texto**. Siete ya creados
(2026-08-15) más uno nuevo:

```
cf_web_ref     cf_web_bici_id   cf_web_modelo    cf_web_precio
cf_web_puntaje cf_web_ficha_url cf_web_disponible
cf_web_msg     ← el que falta: guarda el texto entrante para poder evaluarlo
```

⚠️ `cf_intencion`, `cf_modelo_buscado`, `cf_telefono` y `cf_ciudad` **ya existen** del DM.
No los dupliques: el atajo del sitio escribe en los MISMOS campos que lee la cascada.

---

## 2. El atajo del sitio — los 3 nodos que se anteponen

### 2.1 · Guardar el mensaje

Nodo **Acciones** → *Establecer valor de campo personalizado*:
`cf_web_msg` = variable **Last Text Input** (botón `{}`).

> `{{last_input}}` sirve para escribir en mensajes pero NO aparece como campo evaluable en
> una Condición. Por eso hay que guardarlo primero.

### 2.2 · ¿Viene del sitio?

Nodo **Condición** sobre `cf_web_msg`, operador **contiene**, en este orden:

| # | Texto a pegar | Intención que se setea |
|---|---|---|
| 1 | `ficha certificada de la Specialized` | `MODELO` |
| 2 | `Quiero encargar una Specialized` | `ASESORIA` |
| 3 | `Quiero consignar mi Specialized` | `VENDER` |
| 4 | `Busco una Specialized usada certificada` | `ASESORIA` |
| 5 | *(else)* → **`mc-clasifica`**, igual que el DM | — |

Los cuatro fragmentos están verificados contra el sitio en producción, son estables (no
cambian por bici ni por formulario) y **ninguno lleva tilde ni signos raros**, a propósito:
un problema de codificación no puede romperlos.

**Por qué esas intenciones:**

- **Ficha → `MODELO`**: la persona ya eligió una bici concreta. Entra al Grupo A, que es el
  54 % del tráfico del DM y ya sabe entregar la ficha rica.
- **Consigna → `VENDER`**: calce exacto. Va a V-1, y `mc-consigna` crea el Lead con
  `Canal = Consignación`.
- **Encargo y General → `ASESORIA`**: van al quiz. El que pide un encargo casi siempre
  quiere algo que no está en vitrina; el quiz o le encuentra algo que sí existe, o cae en
  no-match y ahí la rama de waitlist ya ofrece «Consíganmela». No hay que construir nada.

### 2.3 · Resolver la bici (solo la rama de la ficha)

Antes de entrar a la cascada, la rama FICHA necesita saber de qué bici habla.

Extraer el número de `(ref 4082552)` → `cf_web_ref`. Después, **Solicitud externa**:

```
POST https://biketrust-sitio.pages.dev/api/mc-bici?key=<MC_KEY>
{ "ref": "{{cf_web_ref}}" }
```

Mapeo de la respuesta:

| Campo de la respuesta | Campo de ManyChat |
|---|---|
| `bici` | `cf_web_bici_id` |
| `modelo` | **`cf_modelo_buscado`** ← el que lee la cascada |
| `modelo` | `cf_web_modelo` |
| `precio_texto` | `cf_web_precio` |
| `puntaje` | `cf_web_puntaje` |
| `ficha_url` | `cf_web_ficha_url` |
| `disponible` | `cf_web_disponible` |

🔴 **Guarda de disponibilidad.** Si `cf_web_disponible` **no** es `true`, NO mandar la ficha:
avisar que se vendió y derivar al quiz. Sin esto alguien recibe la ficha de una bici que
ya no está.

---

## 3. Los dos sellos que faltaban

Estos son los que hacen visible la cadena de la Puerta 3 en el tablero. Van **dentro** de
la cascada, no antes.

### 3.1 · «Se les envió la ficha»

Justo después del bloque que manda la ficha (la *ficha rica* compartida del DM):

```
POST https://biketrust-sitio.pages.dev/api/mc-evento?key=<MC_KEY>
{ "subscriber_id": "{{user_id}}", "estado": "ficha_entregada",
  "resultado": "Ficha entregada", "origen": "Web (ficha)", "bici": "{{cf_web_bici_id}}" }
```

### 3.2 · «Aceptaron que te llamen»

En la rama del **sí** de la oferta de llamada (B3), **antes** de pedir el teléfono:

```
POST https://biketrust-sitio.pages.dev/api/mc-acepta?key=<MC_KEY>
{ "subscriber_id": "{{user_id}}" }
```

⚠️ **En ese orden.** Si se sella después de pedir el número, quien acepta y no lo deja
desaparece — y esa es exactamente la fuga que se quiere medir.

---

## 4. El canal de origen

Para que la persona cuente en la **Puerta 3** y no en otra, su Lead necesita
`Canal origen = Web`.

- La cascada ya llama a `mc-lead` en A-1. Basta con que en la rama del sitio se le pase
  `"canal": "Web"`.
- En la rama de mensaje libre (Puerta 4), `"canal": "WhatsApp"`.

```
POST https://biketrust-sitio.pages.dev/api/mc-lead?key=<MC_KEY>
{ "subscriber_id": "{{user_id}}", "canal": "Web", "nombre": "{{first_name}} {{last_name}}" }
```

⚠️ **En WhatsApp NO existe `{{ig_username}}`.** El identificador es siempre
`subscriber_id` = `{{user_id}}`. Todos los endpoints lo aceptan.

---

## 5. Orden de construcción

1. Crear `cf_web_msg`.
2. **Duplicar** la automatización de DM → **Convertir canales** → WhatsApp. Renombrar
   `V3 · WhatsApp entrante`. **Dejar en DRAFT.**
3. Anteponer los 3 nodos del atajo (§2) delante de la entrada a `R-1`.
4. Agregar los dos sellos (§3) dentro de la cascada.
5. Ajustar el `canal` de `mc-lead` (§4).
6. Prueba de humo (§6).
7. Recién ahí, publicar.

---

## 6. Prueba de humo

**Camino del sitio:** entra a una ficha, aprieta «Recibir la ficha por WhatsApp», sigue el
flujo, di que **sí** a la llamada y deja tu número.

**Camino libre:** desde otro número, escribe algo suelto («tienen algo para el cerro?») y
comprueba que `mc-clasifica` lo rutea igual que en el DM.

| Dónde | Qué debe estar |
|---|---|
| `Leads` | `Canal origen = Web` · `Fecha aceptó llamada` · `Aceptó llamada = 1` · `Fecha teléfono` |
| `Intereses` | `Resultado = Ficha entregada`, `Origen = Web (ficha)`, **bici enlazada** |
| `Llamados` | ticket en `Llamada pendiente` con teléfono y bici |
| Tablero → Puertas → Sitio web | las 6 etapas con números |

Después **márcate `DEMO` en Leads e Intereses**. ⚠️ Marcarlo en el Lead **no se propaga**
al Interés: hay que marcarlo en los dos.

---

## 7. Lo que NO hay que hacer

- **No construir una cascada paralela para WhatsApp.** Dos cerebros para el mismo problema
  se desincronizan en semanas.
- **No inventar intenciones nuevas.** Los 12 códigos de `mc-clasifica` ya cubren el tráfico
  real; el atajo del sitio solo *pre-rellena* uno de ellos.
- **No borrar la rama `else`** de la cascada. Sin ella, un valor inesperado mata el flujo en
  silencio: ni mensaje, ni Lead, ni métrica.
