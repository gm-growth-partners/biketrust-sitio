# V2 · Plantilla maestra — Puerta de comentarios

> Diseño de Gabriel, 2026-07-27. **Una sola automatización** que se monta bien una vez y
> se **duplica por cada reel** cambiando solo 3 cosas (§6). El copy es literal.
>
> Objetivo del flujo: que **todo el mundo llegue** al mensaje «¿quieres hablar con un
> especialista?» y que el bot capture el teléfono. La visita la cierra Luis en la llamada.

---

## 1 · El flujo en una mirada

```
comentario con palabra clave
  └─ [tracking: mc-lead → mc-evento]        ← invisible, ANTES del mensaje
  └─ respuesta pública rotada
  └─ B1  "¿Quieres ver la ficha técnica?"   ← DEBE llevar botón de flujo
        ├─ toca el botón ──────────┐
        └─ escribe cualquier cosa ─┤
  └─ B2  LA FICHA                  ┘
        ├─ escribe algo  ────────────┐
        └─ pasan ~40 s sin responder ┤
  └─ B3  "¿Hablamos con un especialista?"  ┘
        ├─ Sí → B4 teléfono → B5 eco → [mc-llamado] → B6 confirmación
        └─ No → B7 salida blanda
```

## 2 · Los dos gotchas que definen la estructura

1. **La respuesta privada a un comentario es TERMINAL.** Instagram no deja encadenar otro
   mensaje automático después. El hilo solo revive si la persona **toca un botón de flujo**
   («Ir a un paso»), nunca con un botón de URL. → Por eso **todo el tracking va ANTES** del
   primer mensaje, y **B1 obligatoriamente lleva botón de flujo**.
2. **`mc-lead` SIEMPRE antes que `mc-evento`.** Si se invierte, el lead nace con
   `Canal = Quiz` y se pierde la atribución al reel.

## 3 · Campos personalizados (17, todos tipo texto)

**Los que llena la respuesta de `mc-evento`** (mapeo directo, §5.2):
`cf_bici_modelo` · `cf_bici_puntaje` · `cf_bici_area_baja` · `cf_bici_estado_honesto` ·
`cf_bici_precio` · `cf_bici_precio_nuevo` · `cf_bici_ahorro` · `cf_bici_rango_altura` ·
`cf_bici_foto` · `cf_bici_ficha` · `cf_bici_disponible` · `cf_bici_bateria` · `cf_bici_ciclos`

**De la conversación:**
`cf_lead_id` · `cf_telefono` · `cf_mensaje` (lo que la persona escribió — Luis lo lee antes de llamar) ·
`cf_oferta_enviada` (bandera anti-duplicado, §4.3)

> ⚠️ **Borrar el grupo de `cf_bici_*` al inicio de cada corrida** (acción «borrar valor»),
> antes de llamar a `mc-evento`. El mapeo de respuesta no limpia campos vacíos: sin ese
> borrado, un lead puede recibir el puntaje de la bici anterior. Es la falla más silenciosa
> del sistema.

## 4 · Los bloques

### Disparador
Instagram → Comentario en **el post específico** → **10 palabras clave** (§6) →
«Enviar primer mensaje como respuesta privada» **ACTIVADO**.

### Acción 0 · Tracking (antes de cualquier mensaje)
1. Borrar valor de los 13 `cf_bici_*`
2. Solicitud externa → `mc-lead`
3. Solicitud externa → `mc-evento` (§5)

### Respuesta pública (rotar 5 variantes, sin links)
`Te escribí al DM 📩` · `Te mandé el detalle por interno 📩` · `Al DM te llegó todo 📩` ·
`Revisa tu DM, te mandé la ficha 📩` · `Te escribí por interno 📩`

> Si la persona no te sigue, el DM cae en **Solicitudes de mensaje**. Vale agregar en una de
> las variantes: `Si no te aparece, míralo en Solicitudes de mensaje`.

---

### B1 · Primer DM — la oferta de la ficha
> Este es el mensaje terminal. Sin botón de flujo, el lead muere acá.

```
Hola 👋 Vi tu comentario en la {{cf_bici_modelo}}.

¿Quieres ver la ficha técnica con specs, precio y la nota que sacó en nuestra inspección?
```
**Botones (de FLUJO, no URL):** `Sí, muéstramela` · `Tengo una consulta`

**Si escribe en vez de tocar el botón:** cualquier texto entra igual a B2 — **salvo que sea
una baja** (ver abajo). Se guarda lo que escribió en `cf_mensaje` y se sigue de largo: quien
escribe está más caliente que quien toca un botón, no se le puede castigar con un «no te entendí».

> ⚠️ **ANTES del catch-all va la condición de baja.** Sin ella, alguien que responde «no me
> escriban más» recibe la ficha con precio y 40 segundos después la pedida de teléfono. Eso
> es un reporte de spam — y como el mismo número lleva los mensajes transaccionales, la
> pérdida de calidad ante Meta se paga en las confirmaciones y recordatorios que sí importan.
>
> **Palabras de baja** (evaluadas primero, en B1 y también en B3):
> `stop` · `baja` · `no me escribas` · `no me escriban` · `no me molesten` · `sácame` ·
> `sacame` · `unsubscribe` · `no quiero` · `déjenme`
>
> **Acción:** Unsubscribe nativo de ManyChat + tag `baja_voluntaria` + **NO seguir a B2**.
> Respuesta única y seca, sin intentar recuperar:
> ```
> Listo, no te escribimos más 👌
> ```
> Es el mismo componente que ya está especificado para la puerta de DM: **se monta una vez y
> las dos puertas lo invocan.** El comportamiento tiene que ser idéntico en ambas.
`Tengo una consulta` → también va a B2 (primero la ficha, después conversamos).

---

### B2 · La ficha (el envío de valor)
**Bloque 1 — imagen:** `cf_bici_foto`

**Bloque 2 — texto:**
```
{{cf_bici_modelo}} · Talla {{cf_bici_talla}}

Certificación: {{cf_bici_puntaje}}/7 🔧
Donde perdió puntos: {{cf_bici_area_baja}}

Estado honesto, tal cual está hoy:
{{cf_bici_estado_honesto}}

Nueva hoy sale {{cf_bici_precio_nuevo}}.
Esta queda en {{cf_bici_precio}} → te ahorras {{cf_bici_ahorro}}.
```

**Bloque 3 — link:** `Ficha completa con todas las fotos: {{cf_bici_ficha}}`

**Variante e-bike** (condición: `cf_bici_bateria` no está vacío) — agregar antes del precio:
```
Diagnóstico de batería: {{cf_bici_bateria}}% de salud · {{cf_bici_ciclos}} ciclos.
Regla nuestra: bajo 80% no la vendemos.
```

**Variante bici ya vendida** (condición: `cf_bici_disponible` = false) — reemplaza todo B2:
```
Te soy derecho: esa unidad ya se vendió 🙈 El video sigue dando vueltas.

Pero si es la que andabas buscando, te la conseguimos. Todas las semanas salimos a buscar modelos específicos para gente que nos los encarga.

¿Te contactamos con nuestro especialista para que te asesore?
```
**Botones:** `Sí, que me llamen` · `Ver lo que hay ahora`

> No es una lista de espera pasiva («te aviso si entra»), es un **encargo activo** («te la
> conseguimos»). Es la prioridad #2 del negocio según Roberto, y convierte la peor noticia
> posible en la mejor demostración del servicio. `Sí, que me llamen` salta a B4 (teléfono).

---

### B3 · La oferta de llamada — **todos tienen que llegar acá**

Hay **dos caminos de entrada** y ambos terminan en el mismo bloque:

- **(a) La persona escribe algo** después de la ficha (una consulta, «cuánto es en cuotas», lo que sea)
  → se guarda en `cf_mensaje` → entra a B3.
- **(b) Pasan ~40 segundos sin respuesta** → Smart Delay → entra a B3.

```
¿Te gustaría hablar directamente con un especialista por teléfono para orientarte mejor?

Te resuelve las dudas que por chat no se responden bien: si esa talla te calza, el historial completo de la unidad, y cómo la despachamos si estás fuera de Santiago.
```
**Botones:** `Sí, que me llamen` · `Por ahora no`

> **§4.3 · La bandera anti-duplicado.** Los dos caminos pueden dispararse casi a la vez (la
> persona escribe justo cuando vence el delay) y mandarían B3 dos veces. Antes de enviar B3,
> **condición: si `cf_oferta_enviada` = `si`, no hacer nada**; si está vacío, setearlo en
> `si` y recién ahí enviar. Sin esto, el mensaje más importante del embudo llega duplicado.
>
> **Sobre los 40 segundos:** con 5 s la ficha ni alcanza a leerse y se siente atropellado;
> con más de 2 min el lead ya se fue. 40 s es el punto donde alcanzó a mirar la foto y el
> precio. Es un número tuneable — lo importante es la bandera, no el valor exacto.

---

### B4 · El teléfono
```
Perfecto 🙌 ¿A qué número te llamamos?

Escríbelo como quieras (9 1234 5678, +569…, da lo mismo).
```
Paso de **entrada de usuario tipo teléfono** → guarda en `cf_telefono`.
Activar **«Guardar como ID de WhatsApp»** (lo necesita el motor de recordatorios).

**Si el número viene mal** (menos de 8 dígitos), reintento sin culpar a la persona:
```
Creo que se cortó un dígito 🙈 ¿me lo mandas de nuevo? Así sirve: 9 1234 5678
```

### B5 · Eco de confirmación
```
Anotado: {{cf_telefono}} ✅
```
**Botones:** `Correcto` · `Corregir`

> Es el único dato que la persona teclea en todo el flujo. Sin eco, un dígito mal escrito no
> se detecta hasta que Luis marca y le contesta un desconocido — y ese lead se pierde sin
> que nadie sepa por qué.

### Acción · Solicitud externa → `mc-llamado`
Crea el ticket y dispara el aviso a Luis. **NO mandar `optin`** (§5.3).

### B6 · Confirmación final
```
Listo ✅ Te va a llamar Luis Sulbarán, nuestro especialista, lo antes posible.

Te marca desde el +56 9 XXXX XXXX — guarda el número así sabes que somos nosotros 😉

Si no te pilla, te deja un WhatsApp a ese mismo número.
```

> **La última línea no es relleno.** Hace dos cosas: baja la ansiedad de «¿y si no
> contesto?», y sobre todo **abre el permiso** para el mensaje automático del §8. Sin
> anunciarlo acá, escribirle por WhatsApp a alguien que dio su número para una llamada es
> usar un consentimiento de un canal en otro.

> **Por qué esta línea importa más de lo que parece:** el 87 % de la gente no contesta
> llamadas de números desconocidos, y Chile tiene el prior de spam más alto del mundo.
> Anunciar el número antes de marcar sube la contestación de menos del 9 % a más del 70 %.
> **Hay que poner el número real de Luis.**

### B7 · Salida blanda («Por ahora no»)
```
Dale, sin problema 👌 Cero llamadas.

Cualquier duda me escribes por acá. Y si alguien la aparta antes, te aviso.
```

---

## 5 · Las tres solicitudes externas

### 5.1 · `mc-lead` (POST)
`https://biketrust-sitio.pages.dev/api/mc-lead?key=<MC_KEY>`
```json
{ "handle": "<Nombre de usuario>", "canal": "Comentario IG" }
```
> El handle se inserta con el **campo de sistema «Nombre de usuario»** de Instagram.
> Nunca escribirlo como merge tag a mano: así nació el lead basura `@{{ig_username}}`.
> **No mandar `nombre`**: los comentarios casi nunca traen nombre real y llega el literal `{{full_name}}`.

### 5.2 · `mc-evento` (POST) — el que trae los datos de la bici
`https://biketrust-sitio.pages.dev/api/mc-evento?key=<MC_KEY>`
```json
{
  "handle": "<Nombre de usuario>",
  "estado": "ficha_entregada",
  "origen": "Puerta 1 (reel/comentario)",
  "resultado": "Ficha entregada",
  "reel": "<SHORTCODE DE ESTE REEL>"
}
```
**Mapeo de la respuesta** (campos planos de primer nivel, no rutas anidadas):

| Respuesta | → Campo |
|---|---|
| `biciModelo` | `cf_bici_modelo` |
| `biciTalla` | `cf_bici_talla` |
| `biciPuntaje` | `cf_bici_puntaje` |
| `biciAreaBaja` | `cf_bici_area_baja` |
| `biciEstadoHonesto` | `cf_bici_estado_honesto` |
| `biciPrecio` · `biciPrecioNuevo` · `biciAhorro` | `cf_bici_precio` · `cf_bici_precio_nuevo` · `cf_bici_ahorro` |
| `biciRangoAltura` | `cf_bici_rango_altura` |
| `biciFoto` · `biciFicha` | `cf_bici_foto` · `cf_bici_ficha` |
| `biciDisponible` | `cf_bici_disponible` |
| `biciBateria` · `biciCiclos` | `cf_bici_bateria` · `cf_bici_ciclos` |
| `leadId` | `cf_lead_id` |

> ⚠️ **Estos campos de respuesta requieren el `mc-evento` actualizado**, que hoy está escrito
> pero **sin desplegar**. Sin ese deploy, `mc-evento` solo devuelve ids y B2 queda en blanco.

### 5.3 · `mc-llamado` (POST)
`https://biketrust-sitio.pages.dev/api/mc-llamado?key=<MC_KEY>`
```json
{
  "handle": "<Nombre de usuario>",
  "telefono": "{{cf_telefono}}",
  "reel": "<SHORTCODE DE ESTE REEL>",
  "notas": "Puerta 1 · dijo: {{cf_mensaje}}"
}
```
> **No mandar `optin: true`.** El teléfono se pidió para una llamada, no para mensajes.
> El permiso de WhatsApp lo marca **Luis en la llamada** (checkbox `Permiso WhatsApp` en
> Airtable). Mandarlo desde el bot es usar un consentimiento de un canal en otro.
>
> **No mandar `ciudad` ni `franja`:** la ubicación la pregunta Luis («¿de qué comuna me
> hablas?»), que da mejor dato que un sí/no y no interroga a nadie por chat.

---

## 6 · Cómo se duplica (lo único que cambia)

Al publicar un reel nuevo: duplicar la automatización y tocar **3 cosas**:

1. **El post del disparador**
2. **Las 10 palabras clave**
3. **El `reel` en el body de `mc-evento` y de `mc-llamado`** (el shortcode del post)

Y en Airtable, 1 fila nueva en `Reels`: `Post ID Instagram` + link a la `Bici` + `Tipo`.

**Todo el resto queda igual**, porque los datos de la bici los trae `mc-evento` desde
Airtable. Si mañana cambia el precio o el estado honesto, el DM lo refleja solo.

### Los 6 reels vivos
| Shortcode | Bici |
|---|---|
| `DbCLcpEB4aT` | Epic 8 Pro · L |
| `DbEh9fBI9Np` | Levo SL S-Works · M |
| `DbQjdNLBmnv` | Creo SL S-Works · M |
| `Dad9A_zJy0D` | Levo SL2 S-Works · S4 |
| `DZ1O3ViO2Qz` | Levo 4G S-Works · S4 |
| `DbJy7ynB5T4` | *(VS Tarmac/Creo — sin bici, deriva al quiz)* |

### Cómo elegir las 10 palabras clave
Solo hay 10 cupos y no hay término medio (o keywords, o cualquier comentario). Repartirlos así:
- **3–4 del modelo:** la palabra del caption + variantes (`epic`, `epic 8`, `levo`, `creo`, `sl`)
- **4 de precio:** `precio`, `valor`, `cuanto`, `$$$` — en la semana 30 se perdieron comentarios como «Valor», «Valor ?», «$$», «Precio x favor»
- **2 de disponibilidad:** `disponible`, `queda`

> Con las 10 palabras se asume perder la cola larga (el «💎💎💎» de bikeprotekt entró por
> any-word y era un lead real). Es el precio de que el filtro deje pasar solo intención declarada.

---

## 8 · El ciclo «No contestó» (rescate automático)

Las 4 salidas que Luis marca en Airtable al colgar:

| Salida | Qué pasa después |
|---|---|
| `Agendamiento en tienda` | queda la visita → confirmación + recordatorios (ya en vivo) |
| `Llamado de región` | coordinación a distancia |
| `Encargo de búsqueda` | ticket en `Solicitudes` → aviso a Roberto y Alfonso al pasar a `Buscando` |
| **`No contestó`** | **dispara mensaje automático + el ticket sigue abierto** |

### La automatización
Disparador: `Salida` cambia a **`No contestó`** → (1) envía el mensaje, (2) suma 1 a
`Intentos`, (3) **deja `Estado` en `Llamada pendiente`** — no contestar no cierra el ticket,
solo lo devuelve a la cola.

### El mensaje
```
Hola {{1}}, soy Luis de Bike Trust. Te llamé recién por la {{2}} y no te pillé 📞

Te vuelvo a marcar más tarde. Si prefieres otra hora, respóndeme por acá y la coordinamos.
```
`{{1}}` = nombre · `{{2}}` = modelo de la bici.

### ⚠️ Por dónde sale el mensaje — esto define si llega hoy o en 48 horas

Hay **dos caminos** y conviene montar los dos:

**(a) Por Instagram DM — disponible YA, sin aprobación de nadie.**
Si Luis llama dentro de las 24 h desde el último mensaje de la persona (que es el caso
normal: acaba de dar el teléfono hace minutos u horas), la ventana de Instagram **sigue
abierta** y el mensaje sale como DM normal. **Cero trámite, funciona el miércoles.**

**(b) Por WhatsApp — necesita plantilla aprobada por Meta.**
Para los intentos del día siguiente o más, la ventana de IG ya cerró y solo queda WhatsApp
con plantilla. Categoría a declarar: **Utility** — la persona pidió la llamada, así que es
un mensaje de servicio sobre algo que ella solicitó, no promoción. Aprobación típica:
24–48 h. **Si se quiere para el miércoles, hay que enviarla a revisión hoy.**

> Recomendación: montar **(a)** para el miércoles y **(b)** en paralelo. Así el rescate
> funciona desde el día uno para el caso más frecuente, y cuando Meta apruebe se extiende
> solo a los intentos tardíos. La condición es simple: si la ventana de IG está viva → DM;
> si no → plantilla de WhatsApp.

### Cambio pendiente en Airtable
El campo `Salida` hoy tiene 5 opciones (`Visita agendada`, `Coordinación región`,
`Encargo de búsqueda`, `Solo información`, `Sin interés`). Hay que **agregar `No contestó`**.
La API de Airtable no agrega opciones a un select existente → se hace a mano en la tabla.

---

## 7 · Antes de montar, 3 verificaciones

1. **¿Meta aprobó la plantilla `nuevo_llamado`?** Quedó en revisión el 2026-07-09 y nunca se
   confirmó. **Si está rechazada, Luis no se entera de que entró un lead** y el embudo muere
   en el ticket. Es lo único genuinamente bloqueante.
2. **Desplegar `mc-evento`** (§5.2), o B2 llega vacío.
3. **La pantalla de Luis** en Airtable, con permiso de **Editar** al compartir. Los campos ya
   están creados (`Salida`, `Permiso WhatsApp`, `Próximo paso`, `Intentos` + el brief).
