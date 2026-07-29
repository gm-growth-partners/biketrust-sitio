# Runbook de montaje en ManyChat — V2

> **Qué es esto.** El documento único para montar la capa conversacional V2 sin tener que
> consultar otros archivos ni preguntar detalles técnicos. Todo lo que dice acá está
> verificado contra el código y contra los documentos fuente (auditoría 2026-07-28: se
> cazaron 37 afirmaciones falsas en el material previo, ver §10).
>
> **Precedencia.** Cuando este runbook y otro documento se contradigan, manda este.
> Los documentos de diseño (`V2_PLANTILLA_*`, `V2_SALIDAS_LLAMADA`, `MANYCHAT_REBUILD`,
> `V2_DIA1_INSUMOS`) quedan como el porqué; este es el cómo.

---

## §0 · Las 8 decisiones que hay que tomar antes de tocar ManyChat

Los documentos de diseño dejaron estos puntos abiertos o en contradicción. Cada uno trae
la recomendación y su razón. **Ninguna necesita código nuevo.**

| # | Decisión | Recomendación | Por qué |
|---|---|---|---|
| 1 | **Qué hoja de campos se monta** (hay 4 listas: 19, 37, 44, y el mínimo) | **Las 29 del §2** | Las hojas de 37 y 44 son de antes del pivote e incluyen el tronco de agenda (`cf_slot`, `cf_fecha_libre`, `cf_valido`) y la región (`cf_ciudad`, `cf_franja`) que el V2 **ya no usa**: la ubicación la pregunta Luis. Crear 44 es crear 15 campos muertos |
| 2 | **`{{1}}` = nombre** en las 2 plantillas nuevas | **Sacar el nombre. `Hola 👋`** | No existe ningún `cf_nombre`, y un merge tag que no resuelve **llega como texto literal**: el riesgo real es mandar «Hola {{1}}». Es además la convención de las 4 plantillas ya aprobadas. Si después se quiere, se agrega — pero cambiar el cuerpo de una plantilla la manda de vuelta a revisión |
| 3 | **Destino de `Ver lo que hay ahora`** (B2 bici vendida) | **→ B3** para el lanzamiento; re-apuntar al quiz cuando exista la puerta de DM | La persona quiere alternativas; la respuesta correcta es el quiz, pero el quiz vive en la puerta de DM que se monta después. B3 la lleva igual a la llamada, que es el objetivo |
| 4 | **Destino de `Corregir`** (B5) | **→ B4** | Único destino con sentido |
| 5 | **Destino de los 3 botones del anti-bucle** | `Busco una bici`→Grupo A · `Ayúdenme a elegir`→Grupo B (quiz) · `Quiero vender`→Grupo C | Es lo que el §2 del doc de DM implica; nunca se escribió explícito |
| 6 | **Reparto de las 10 keywords** (dos docs proponen repartos distintos) | **El de `V2_PLANTILLA_COMENTARIOS` §6** (§4 de acá) | Es el documento de copy y el más nuevo |
| 7 | **Respuesta pública: 3 o 5 variantes** | **Las 5** del doc de copy, **+ el delay de ~3 s** de INSUMOS | No se excluyen: el delay es higiene anti-spam, las variantes son rotación |
| 8 | **Rotar `MC_KEY` ahora o al final** | **AL FINAL**, cuando se apaguen las automatizaciones V1 | El plan D1 mandaba rotarla al inicio porque asumía demoler la V1 primero. La V1 está VIVA y llamando a los endpoints: rotar ahora la deja fuera de servicio de golpe. Montar el V2 con la llave actual y rotar en el go-live |

**Dato que solo tienes tú:** el **número de teléfono real de Luis** para B6 — en el copy está
como el placeholder literal `+56 9 XXXX XXXX`.

---

## §1 · Orden de montaje

```
1. Verificar los 3 pre-checks bloqueantes  (§1.1)
2. Crear los 29 custom fields              (§2)
3. Montar la puerta de comentarios COMPLETA (§3) sobre UN solo reel
4. Probar ese reel de punta a punta          (§8)
5. Recién ahí duplicar ×5                    (§4)
6. Montar la puerta de DM                    (§5)
7. Las 2 plantillas + flujos envoltorio + envs de Cloudflare (§6)
8. Go-live: rotar MC_KEY, apagar la V1       (§9)
```

**Por qué probar antes de duplicar:** el paso 5 replica seis veces cualquier error del
paso 3. Un `reel` mal pegado en un duplicado no se nota nunca — el lead entra igual, solo
que sin atribución.

### §1.1 · Pre-checks

| # | Qué | Estado |
|---|---|---|
| 1 | **¿Meta aprobó `nuevo_llamado`?** | ⚠️ **Es el único bloqueante real.** Sin esa plantilla, entra un lead con teléfono y **Luis no se entera**. Todo lo demás se puede lanzar cojo; esto no |
| 2 | **`mc-evento` con el payload de bici, desplegado** | ✅ Ya está. Está en `main` y Cloudflare autodespliega. Los 21 campos planos salen (`mc-evento.js` líneas 205–228). *Los docs que dicen «escrito pero sin desplegar» están vencidos* |
| 3 | **Luis con asiento de EDITOR en Airtable** | ⚠️ Sin verificar. Sin permiso de edición no puede arrastrar tarjetas y el Kanban no sirve |

---

## §2 · Los 29 custom fields — **todos tipo texto**

⚠️ **`setCustomFieldByName` busca por string exacto.** Un nombre mal escrito hace que el
mensaje no salga y el error queda en un JSON que nadie mira. Copiar y pegar, no tipear.

**Grupo A · Los que escribe el backend (8).** Nombre literal obligatorio:

```
cf_bici
cf_modelo
cf_fecha_visita
cf_consigna_datos
cf_solicitud_datos
cf_llamado_datos
cf_reagendo_datos
cf_agenda_hoy
```

> ⚠️ **`cf_modelo`, `cf_reagendo_datos` y `cf_agenda_hoy` no están en ninguna hoja anterior.**
> Las hojas viejas dicen «5 campos literales del backend»; grepeando el código son **8**.
> `cf_agenda_hoy` lo imprime el briefing diario y `cf_reagendo_datos` el aviso de reagendo:
> si faltan, **esos dos mensajes mueren**. `cf_modelo` falla distinto y peor: su helper no
> comprueba la respuesta, así que el WhatsApp **sale igual, con la variable vacía**.

**Grupo B · Los que llena la respuesta de `mc-evento` (14):**

```
cf_bici_modelo
cf_bici_talla
cf_bici_puntaje
cf_bici_area_baja
cf_bici_estado_honesto
cf_bici_precio
cf_bici_precio_nuevo
cf_bici_ahorro
cf_bici_rango_altura
cf_bici_foto
cf_bici_ficha
cf_bici_disponible
cf_bici_bateria
cf_bici_ciclos
```

> ⚠️ **`cf_bici_talla` falta en la lista del documento de diseño** (dice «18 campos» y
> enumera 13 `cf_bici_*`), pero su propio copy de B2 lo imprime. Sin él, la talla sale vacía.

**Grupo C · De la conversación (5):**

```
cf_lead_id
cf_telefono
cf_promesa
cf_mensaje
cf_oferta_enviada
```

**Grupo D · Anti-bucle de la puerta de DM (2):**

```
cf_no_reconocido
cf_modo_humano
```

**Por qué todos texto y ninguno número/booleano:** las condiciones del copy comparan contra
strings (`cf_oferta_enviada = si`, `cf_bici_disponible = false`, `cf_modo_humano = si`).
Un campo tipo número rompe esas comparaciones.

**Los que NO hay que crear** (están en las hojas viejas y el V2 no los usa): `cf_ciudad`,
`cf_franja`, `cf_slot`, `cf_fecha_libre`, `cf_valido`, `cf_fecha_visita_legible`, `cf_brief`,
`cf_no_texto_intentos`. Los grupos de `mc-match` / `mc-consigna` (`cf_hero_*`, `cf_alt_*`,
`cf_q_*`, `cf_v_*`) se crean recién al montar las rutas de la puerta de DM.

---

## §3 · Puerta 1 · Comentarios — bloque por bloque

Se monta **una vez, sobre un solo reel**, y recién después se duplica.

### Disparador

- Post: **uno solo** (recomendado `DbEh9fBI9Np` «SL», que es el 2º con más volumen y sí tiene
  palabra clave en el caption).
- **10 palabras clave** (§4).
- ✅ Activar **«Enviar primer mensaje como respuesta privada»**.

### Acción 0 · Tracking (invisible, ANTES de cualquier mensaje)

**Este orden no es negociable:**

1. **Borrar valor** de los **14** `cf_bici_*` del Grupo B.
2. Solicitud externa → `mc-lead`
3. Solicitud externa → `mc-evento`

> **Por qué borrar primero:** el mapeo de respuesta de ManyChat **no limpia los campos que
> vienen vacíos**. Sin el borrado se arrastra la bici del lead anterior. Es «la falla más
> silenciosa del sistema»: nadie la ve hasta que un cliente recibe la ficha equivocada.
>
> **Por qué `mc-lead` antes que `mc-evento`:** invertido, el lead nace con `Canal = Quiz` y
> se pierde la atribución al reel.
>
> **Por qué todo antes del primer mensaje:** la respuesta privada a un comentario es
> **terminal** — Instagram no deja encadenar otro mensaje automático después. El hilo solo
> revive si la persona toca un **botón de flujo** («Ir a un paso»), nunca un botón de URL.

**Body de `mc-lead`** → `POST https://biketrust-sitio.pages.dev/api/mc-lead?key=<MC_KEY>`

```json
{ "handle": "<Nombre de usuario>", "canal": "Comentario IG" }
```

**Body de `mc-evento`** → `POST https://biketrust-sitio.pages.dev/api/mc-evento?key=<MC_KEY>`

```json
{
  "handle": "<Nombre de usuario>",
  "estado": "ficha_entregada",
  "origen": "Puerta 1 (reel/comentario)",
  "resultado": "Ficha entregada",
  "reel": "<SHORTCODE DE ESTE REEL>"
}
```

- `<Nombre de usuario>` = **el campo de sistema de Instagram**, insertado desde el selector
  de ManyChat. ⚠️ **Nunca tipearlo como merge tag a mano** — así nació el lead basura
  `@{{ig_username}}`, y `handle` es el único campo que el backend **no** filtra.
- ⚠️ **No mandar `nombre`**: llega el literal `{{full_name}}`.

**Mapeo de respuesta de `mc-evento`** (usar siempre los campos planos de primer nivel; la UI
de ManyChat no lee bien rutas anidadas):

| Respuesta | → Custom field |
|---|---|
| `biciModelo` | `cf_bici_modelo` |
| `biciTalla` | `cf_bici_talla` |
| `biciPuntaje` | `cf_bici_puntaje` |
| `biciAreaBaja` | `cf_bici_area_baja` |
| `biciEstadoHonesto` | `cf_bici_estado_honesto` |
| `biciPrecio` | `cf_bici_precio` |
| `biciPrecioNuevo` | `cf_bici_precio_nuevo` |
| `biciAhorro` | `cf_bici_ahorro` |
| `biciRangoAltura` | `cf_bici_rango_altura` |
| `biciFoto` | `cf_bici_foto` |
| `biciFicha` | `cf_bici_ficha` |
| `biciDisponible` | `cf_bici_disponible` |
| `biciBateria` | `cf_bici_bateria` |
| `biciCiclos` | `cf_bici_ciclos` |
| `leadId` | `cf_lead_id` |

> ⚠️ **Los 21 campos `bici*` DESAPARECEN del JSON si no se resolvió la bici** — no llegan
> vacíos, no llegan. El mapeo tiene que tolerar la ausencia. Es exactamente el caso del
> reel 6 (`DbJy7ynB5T4`), que no tiene bici a propósito.

### B1 · Primer DM

> Mensaje **terminal**. Sin botón de flujo el lead muere acá.

```
Hola 👋 Vi tu comentario en la {{cf_bici_modelo}}.

¿Quieres ver la ficha técnica con specs, precio y la nota que sacó en nuestra inspección?
```

**Botones — de FLUJO, no de URL:**

| Botón | Chars | Va a |
|---|---|---|
| `Sí, muéstramela` | 15 | B2 |
| `Tengo una consulta` | 18 | **B2** (primero la ficha, después conversamos) |

**Catch-all:** escribe cualquier texto → B2, guardando lo escrito en `cf_mensaje`.
*Razón: quien escribe está más caliente que quien toca un botón; no se le puede castigar con
un «no te entendí».*

### B1-bis · Opt-out — se evalúa ANTES que todo lo demás

Regla propia, con acción **Unsubscribe** nativa + tag `baja_voluntaria` + **NO seguir a B2**:

```
stop
baja
no me escribas
no me escriban
no me molesten
sácame
sacame
unsubscribe
no quiero
déjenme
```

Respuesta única, seca, sin intentar recuperar:

```
Listo, no te escribimos más 👌
```

> **Por qué va primero:** sin esto, quien escribe «no me escriban más» recibe la ficha y 40 s
> después la pedida de teléfono = reporte de spam. Y ese mismo número queda recibiendo los
> transaccionales.
>
> Es **el mismo componente** para las dos puertas: se monta una vez y ambas lo invocan.
> También se evalúa en B3.

### B2 · La ficha

**Bloque 1 — imagen:** alimentada por `cf_bici_foto`.

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

**Bloque 3 — link:**

```
Ficha completa con todas las fotos: {{cf_bici_ficha}}
```

**Variante e-bike** — condición `cf_bici_bateria` no vacío. Se agrega **antes del precio**:

```
Diagnóstico de batería: {{cf_bici_bateria}}% de salud · {{cf_bici_ciclos}} ciclos.
Regla nuestra: bajo 80% no la vendemos.
```

**Variante bici vendida** — condición `cf_bici_disponible` = `false`. **Reemplaza todo B2:**

```
Te soy derecho: esa unidad ya se vendió 🙈 El video sigue dando vueltas.

Pero si es la que andabas buscando, te la conseguimos. Todas las semanas salimos a buscar modelos específicos para gente que nos los encarga.

¿Te contactamos con nuestro especialista para que te asesore?
```

| Botón | Chars | Va a |
|---|---|---|
| `Sí, que me llamen` | 17 | **B4 directo** (se salta B3) |
| `Ver lo que hay ahora` | **20 — al límite exacto** | **B3** (decisión §0.3) |

### B3 · La oferta de llamada

Entran los dos caminos: **(a)** la persona escribe algo después de la ficha → se guarda en
`cf_mensaje`; **(b)** pasan **~40 s** sin respuesta (Smart Delay).

**⚠️ Antes de enviar, condición obligatoria:** si `cf_oferta_enviada` = `si` → **no hacer
nada**. Si está vacío → setearlo en `si` y **recién ahí** enviar. Sin esa bandera, los dos
caminos pueden dispararse casi a la vez y B3 llega duplicado.

```
¿Te gustaría hablar directamente con un especialista por teléfono para orientarte mejor?

Te resuelve las dudas que por chat no se responden bien: si esa talla te calza, el historial completo de la unidad, y cómo la despachamos si estás fuera de Santiago.
```

| Botón | Chars | Va a |
|---|---|---|
| `Sí, que me llamen` | 17 | B4 |
| `Por ahora no` | 12 | B7 |

### B4 · El teléfono

```
Perfecto 🙌 ¿A qué número te llamamos?

Escríbelo como quieras (9 1234 5678, +569…, da lo mismo).
```

Paso de **entrada de usuario tipo teléfono** → guarda en `cf_telefono`.
✅ Activar **«Guardar como ID de WhatsApp»** — lo necesita el motor de recordatorios.

**Si viene mal (menos de 8 dígitos)** — reintento sin culpar a la persona:

```
Creo que se cortó un dígito 🙈 ¿me lo mandas de nuevo? Así sirve: 9 1234 5678
```

**Máximo 2 reintentos**, después salida lateral («si prefieres, te mando la ficha por acá»).
**Nunca un tercer «no te entendí el número».**

### B5 · Eco de confirmación

```
Anotado: {{cf_telefono}} ✅
```

| Botón | Va a |
|---|---|
| `Correcto` | → Solicitud externa `mc-llamado` → B6 |
| `Corregir` | → **B4** (decisión §0.4) |

> **Por qué existe:** es el único dato que la persona teclea en todo el flujo, e Instagram
> **no comparte el teléfono del usuario** (no hay autofill). Sin eco, un dígito malo no se
> detecta hasta que Luis marca.

### Acción · `mc-llamado`

`POST https://biketrust-sitio.pages.dev/api/mc-llamado?key=<MC_KEY>`

```json
{
  "handle": "<Nombre de usuario>",
  "telefono": "{{cf_telefono}}",
  "reel": "<SHORTCODE DE ESTE REEL>",
  "notas": "Puerta 1 · dijo: {{cf_mensaje}}"
}
```

- ⚠️ **No mandar `ciudad` ni `franja`.** En V2 la ubicación la pregunta Luis.
- **`optin` no hace falta**: entregar el teléfono ya activa el opt-in en este endpoint.

**Mapeo de respuesta:** `promesaLlamada` → `cf_promesa`.

> 🚨 **Gotcha crítico — la rama `dedup`.** Si el lead ya tenía un ticket abierto (comentó dos
> veces, o comentó y después mandó DM), el endpoint **no crea otro ticket**: devuelve
> `dedup: true` y **NO devuelve `promesaLlamada` ni `dentroDeHorario`**. Si B6 imprime
> `{{cf_promesa}}` sin más, ese lead recibe «Te va a llamar Luis, .» con el hueco.
>
> **Solución:** condición después de `mc-llamado` — si la respuesta trae `dedup` = `true`,
> mandar una variante de B6 sin la promesa (ej. *«Ya tenía tu solicitud anotada — Luis te
> llama en cuanto pueda»*). El endpoint igual concatena lo nuevo en las notas del ticket.

### B6 · Confirmación final

```
Listo ✅ Te va a llamar Luis Sulbarán, nuestro especialista, {{cf_promesa}}.

Te marca desde el +56 9 XXXX XXXX — guarda el número así sabes que somos nosotros 😉

Si no te pilla, te deja un WhatsApp a ese mismo número.
```

- ⚠️ **`+56 9 XXXX XXXX` es un placeholder literal**: poner el número real de Luis. No es
  variable de ManyChat.
- ⚠️ **La última línea no se puede sacar.** Es donde se declara el permiso que habilita el
  mensaje automático del ciclo «No contestado». Sacarla deja ese mensaje sin base.
- `{{cf_promesa}}` la calcula el endpoint contra `HORARIO_ESPECIALISTA`: *«en los próximos
  minutos»*, *«mañana a partir de las 10:00»*, *«el miércoles a partir de las 10:00»*.
  **Nunca poner «lo antes posible» a mano.**

*Anunciar el número antes de marcar sube la contestación de menos del 9 % a más del 70 %.*

### B7 · Salida blanda

```
Dale, sin problema 👌 Cero llamadas.

Cualquier duda me escribes por acá. Y si alguien la aparta antes, te aviso.
```

---

## §4 · Duplicar ×5 — qué cambia y qué no

Al duplicar la automatización cambian **exactamente 3 cosas**:

1. **El post** del disparador.
2. **Las 10 palabras clave.**
3. **El `reel`** (shortcode) en el body de `mc-evento` **y** de `mc-llamado`. ← los dos.

> ⚠️ Si el flujo quedó con un botón «Abrir ficha» de URL fija, cambiar también el slug. Con
> el diseño de acá no hace falta: la ficha viene en `{{cf_bici_ficha}}` desde Airtable.

**Los 6 reels:**

| # | `reel` (shortcode) | Palabra del caption | Bici |
|---|---|---|---|
| 1 | `DbCLcpEB4aT` | «Epic 8» | Epic 8 Pro · L |
| 2 | `DbEh9fBI9Np` | «SL» | Levo SL S-Works · M |
| 3 | `DbQjdNLBmnv` | «Creo» | Creo SL S-Works · M |
| 4 | `Dad9A_zJy0D` | «Levo SL» | Levo SL2 S-Works · S4 |
| 5 | `DZ1O3ViO2Qz` | *(caption sin palabra clave)* | Levo 4G S-Works · S4 |
| 6 | `DbJy7ynB5T4` | «Ruta» | ⚠️ **SIN BICI, a propósito** |

> **El reel 6 no está roto.** Su fila en `Reels` existe (para que el Interés quede atribuido
> al video) pero **sin `Bici`**, porque el post compara Tarmac vs Creo y enlazar una bici
> haría que `mc-evento` la forzara. **Nunca «arreglarlo» enlazándole una bici.** En ese reel
> los `cf_bici_*` llegan ausentes → B2 no puede armarse → **ese duplicado tiene que saltar
> directo a B3.**
>
> **El reel 5 no tiene palabra clave en su caption.** Hay que decidir con qué llenar sus 10
> cupos, o editar el caption.

**Las 10 keywords, reparto recomendado:**

| Cupos | Categoría | Ejemplos |
|---|---|---|
| 3–4 | **Del modelo** | la palabra del caption + variantes + **typos frecuentes** (`epic`, `epic 8`, `levo`, `creo`, `sl`) |
| 4 | **De precio** | `precio`, `valor`, `cuanto`, `$$$` |
| 2 | **De disponibilidad** | `disponible`, `queda` |

- **10 por regla, no en total.** Si un comentario trae dos, **gana la primera de la lista**.
- **Es binario:** o keywords, o cualquier comentario. No hay intermedio.
- *Por qué tanto cupo a precio:* en la semana 30 se perdieron «Valor», «Valor ?», «$$»,
  «Precio x favor».
- *El costo aceptado:* se pierde la cola larga (el «💎💎💎» que entró por any-word era un
  lead real). Es el precio de que pase solo intención declarada.

**Y en Airtable, por cada reel nuevo:** 1 fila en `Reels` (`tbloabbormHNCAWv1`) con
`Post ID Instagram` = el shortcode + link a la `Bici` + `Tipo = Ficha-modelo`.

> ⚠️ **La fila sola no basta.** ManyChat **no expone en qué post fue el comentario** — por eso
> el shortcode va hardcodeado en el body y por eso cada post necesita su propia
> automatización. Si el `reel` va vacío o equivocado: el Interés nace **sin `Reel` y sin
> `Bici`**, el tablero no atribuye el lead a ningún video, y el ticket de `Llamados` llega
> **sin el brief** (`Puntaje`, `Rango altura`, `Precio`, `Estado bici` son lookups de la bici).

---

## §5 · Puerta 2 · DM

**Se monta después, y no se duplica: es única.** El 81 % de los leads de la semana 30 llegó
por comentario — por eso esa puerta va primero.

**Diferencia clave:** en comentarios la bici se sabe (la resuelve el shortcode). En DM no se
sabe nada: hay que clasificar antes de entregar.

La clasificación la hace la **IA de intención nativa de ManyChat** (✅ confirmado 2026-07-27:
el plan la incluye — era el único riesgo de plataforma del montaje).

### Las 9 intenciones en 4 grupos

Los ejemplos son **lo que escribe la persona**, no copy del bot:

| Grupo | Intención | Ejemplos de entrada | Qué hace el bot |
|---|---|---|---|
| **A** | Modelo específico | «tienen la Levo SL?» · «busco una Epic» | `mc-match` modo A → ficha → **llamada** |
| **A** | Precio | «cuánto vale?» · «a cuánto la dejas» | `mc-match` modo A → ficha → **llamada** |
| **A** | Disponibilidad | «sigue disponible?» · «se vendió?» | `mc-match` modo A → ficha → **llamada** |
| **B** | Asesoría | «qué me recomiendas» · «ando en $3M» | quiz `mc-match` modo B (uso · presupuesto · estatura) → **llamada** |
| **C** | Vender / parte de pago | «vendo mi bici» · «reciben la mía?» | `mc-consigna` → **llamada** |
| **D** | Envíos · Garantía · Pagos | «despachan a Concepción?» · «se puede en cuotas?» | texto de Roberto *(pendiente)* → **llamada** |
| **D** | Ubicación / horario | «dónde están?» | **señal de compra** → directo a la convergencia |

### Las 5 reglas del clasificador

1. **El precio no es una intención, es un modificador.** «Cuánto vale la Levo» es intención
   de modelo con pregunta de precio. Si se hace ruta aparte, colisiona con todo.
2. **Prioridad máxima al opt-out**, siempre, antes que cualquier otra regla.
3. **Si no clasifica, no inventar** → anti-bucle.
4. **Nunca elegir por la persona.** Si el modelo calza con varias, `mc-match` devuelve
   `otrasTexto` ya listo para pegar.
5. **Audio, foto o sticker → no romper.**

**Precio sin bici identificada** («cuánto vale?» a secas):

```
¿Cuál te interesa? Dime el modelo y te paso ficha y precio.
```

**Fallback del Grupo D** — se lanza con esto mientras Roberto no entregue los textos:

```
Eso te lo explica mejor Luis en dos minutos que yo por acá 🙂

¿Te llamamos y de paso te resuelve todo lo demás?
```

**Audio, foto o sticker:**

```
No puedo escuchar audios por acá, pero Luis sí — de hecho es más rápido que te llame.
```

### El anti-bucle — la regla de los dos golpes

> «El modo de falla más caro de un bot conversacional no es equivocarse: es **insistir**.
> Una persona que recibe dos veces el mismo "cuéntame un poco más" ya no vuelve.»

**1º no reconocido** — una sola aclaración, con 3 botones (siempre salida garantizada).
Guardar lo escrito en `cf_mensaje` + tag `intencion_no_reconocida`, sumar 1 a
`cf_no_reconocido`:

```
Cuéntame un poco más y te ayudo 🙂

¿Andas buscando una bici en particular, quieres que te ayudemos a elegir, o tienes una para vender?
```

| Botón | Chars | Va a (decisión §0.5) |
|---|---|---|
| `Busco una bici` | 14 | Grupo A |
| `Ayúdenme a elegir` | 17 | Grupo B (quiz) |
| `Quiero vender` | 13 | Grupo C |

*Son exactamente 3 = el tope de Meta. No se le puede agregar una cuarta salida sin partirlo
en dos niveles.*

**2º no reconocido — el último mensaje del bot:**

```
Prefiero que te responda alguien del equipo y no hacerte perder el tiempo 🙌

Le avisé a Luis, te responde por acá en un rato.
```

→ acción **Notificar al administrador** (nativa: llega al Inbox y a la app, **no necesita
plantilla ni aprobación de Meta**) + **Pausar automatizaciones 24 h** + `cf_modo_humano` = `si`.

**El modo humano.** Mientras `cf_modo_humano` = `si`, **el bot no responde nada, aunque
reconozca la intención**. Tres salidas: la pausa expira sola a las 24 h · Luis la libera
desde el Inbox · llega un mensaje que sí clasifica y `cf_no_reconocido` vuelve a 0.

> **Decidido (2026-07-27): el bot NO retoma dentro de las 24 h**, aunque entienda. El costo
> de esperar es bajo; el de interrumpir una conversación humana en curso es alto.

**El balde de fallos:** todo lo no reconocido queda en `cf_mensaje` con el tag. Revisarlo
**una vez por semana**; en 4–6 semanas debería vaciarse solo.

### Lo que la puerta de DM comparte con la de comentarios

**El opt-out** y **la convergencia completa (B3 → B4 → B5 → `mc-llamado` → B6)** son **el
mismo objeto**. Se montan una vez en la puerta de comentarios y la de DM los invoca tal cual.
En el body de `mc-llamado` cambia solo `"notas"` (`Puerta 2 · dijo: {{cf_mensaje}}`) y no
lleva `reel`.

---

## §6 · Las 2 plantillas nuevas y sus envoltorios

### 6.1 · Las plantillas — categoría **Utility**, idioma **Spanish (MEX)**

Convención de las existentes: sin encabezado, footer opcional
`Bike Trust · Specialized certificadas`.

**`region_gestionando`** — *(con la decisión §0.2 aplicada: sin nombre)*

```
Hola 👋 ya quedó todo registrado 📋

Estamos gestionando tu pedido de la {{1}} y coordinando el despacho a tu ciudad. Te escribo por acá apenas tenga novedades.

Cualquier duda, respóndeme a este mismo mensaje.
```

*Esta persona **sí contestó** la llamada: ya sabe quién es Luis, no hace falta presentarse.
Lo que necesita es saber que su caso está vivo.*

**`llamada_no_contestada`**

```
Hola 👋 soy Luis de Bike Trust. Te llamé recién por la {{1}} y no te pillé.

En 5 minutos te digo si es la que te conviene o si mejor esperas otra, y si quieres te la aparto mientras lo decides.

¿Te llamo más tarde o lo vemos por acá?
```

Restricciones **no negociables** del copy:

1. **Es el único mensaje que llega de un número desconocido** → identificarse en la primera
   línea. Sin nombre y motivo en el primer renglón se lee como spam.
2. **Ofrece en vez de pedir** — el apartado es gratis y sin compromiso.
3. **«o si mejor esperas otra»** es la frase clave: es la señal de honestidad. No sacarla.
4. ⛔ **Descartado a propósito:** «hay detalles que no van en la ficha» — contradice la
   propuesta de valor.
5. La variante con escasez («es la única que tengo en esa talla») **no va en el texto fijo**:
   la usa Luis en la llamada.

> ⚠️ **Con la decisión §0.2, el modelo pasa a ser `{{1}}`** (antes el copy lo tenía como
> `{{2}}` porque `{{1}}` era el nombre). **Ojo al bindear:** en las plantillas viejas
> `{{1}}` = `cf_bici` y `{{2}}` = `cf_fecha_visita`. **No copiar el binding de
> `confirmacion_visita`.**
>
> **En estas dos, `{{1}}` se bindea a `cf_modelo`.** El endpoint escribe `cf_bici` y
> `cf_modelo` con el mismo valor, pero `cf_modelo` es el que corresponde semánticamente:
> en un encargo trae lo que la persona **busca**, no la bici del reel.

### 6.2 · Los flujos envoltorio

**Un flujo por plantilla.** No compartir flujo entre plantillas — ese es exactamente el bug
conocido de `FLOW_NS_BUSCANDO`/`FLOW_NS_SOLICITUD`, que hoy apuntan al mismo flujo y hacen
que un encargo que pasa a «Buscando» dispare el aviso de «nueva solicitud».

Reglas del envoltorio:

1. **Contiene SOLO el nodo de WhatsApp** con la plantilla, fuera de la ventana de 24 h.
   Sin condiciones, sin delays, sin pasos previos: `sendFlow` entra por el medio y cualquier
   lógica extra corre sin el contexto de la conversación.
2. **Sin disparador propio** — se dispara solo por API.
3. **Las variables se bindean a custom fields**, nunca a texto fijo ni a merge tags de la
   conversación.
4. **Sin Quick Reply.** `llamada_no_contestada` cierra con pregunta abierta: la respuesta abre
   la ventana de 24 h y cae en la bandeja, que es lo que se quiere.

⛔ **NUNCA borrar ni recrear los 9 flujos envoltorio existentes** (`FLOW_NS_48H`, `FLOW_NS_8AM`,
`FLOW_NS_2H`, `FLOW_NS_CONSIGNA`, `FLOW_NS_SOLICITUD`, `FLOW_NS_LLAMADO`, `FLOW_NS_REAGENDO`,
`FLOW_NS_NOSHOW`, `FLOW_NS_SUELTO`). Recrear un flujo **cambia su `flow_ns`** y hay que
actualizar la env a mano; re-aprobar una plantilla con Meta cuesta días.

### 6.3 · Copiar los namespaces a Cloudflare

Proyecto **`biketrust-sitio`** (los otros dos son el tablero y el worker de cron).

| Env | Flujo |
|---|---|
| `FLOW_NS_REGION` | envoltorio de `region_gestionando` |
| `FLOW_NS_NO_CONTESTA` | envoltorio de `llamada_no_contestada` |

- ⚠️ **Nunca poner un valor de relleno.** Cloudflare no acepta variables vacías, pero con un
  valor falso el código da la env por buena, intenta enviar y devuelve **un error opaco de
  ManyChat** en vez del `falta_env:FLOW_NS_REGION` explícito. Mejor ausente que falsa.
- ⚠️ **Las env solo toman efecto en el siguiente deploy.** Después de pegarlas, redesplegar.
- **Mientras falten no se rompe nada:** `salida-llamado` igual escribe el opt-in, la fecha de
  visita, el estado del lead, el ticket de `Solicitudes` y el `Estado` del ticket. Solo no
  sale el WhatsApp — y como no estampa `Aviso salida enviado`, el caso queda **reintentable**:
  se saca la tarjeta de la columna y se vuelve a poner.

---

## §7 · Los 9 gotchas que rompen en silencio

Ninguno da error visible. Ordenados por lo caro que sale descubrirlos tarde.

| # | Gotcha | Qué pasa |
|---|---|---|
| 1 | **No borrar los 14 `cf_bici_*` al inicio** | El mapeo no limpia campos vacíos → el lead nuevo recibe **la ficha del lead anterior** |
| 2 | **`handle` tipeado a mano** en vez del campo de sistema de IG | `handle` y `subscriber_id` son los únicos campos que el backend **no** filtra: un merge tag sin resolver crea un Lead con handle literal `{{…}}` |
| 3 | **La rama `dedup` de `mc-llamado`** | No devuelve `promesaLlamada` → B6 sale con el hueco. Bifurcar (§3, B5) |
| 4 | **Custom field mal escrito** | `setCustomFieldByName` es por string exacto. En 6 de los 8 sitios el mensaje **no sale**; en `salida-llamado` y `cron-sourcing` **sale con la variable vacía** |
| 5 | **La `?key=` va SOLO en el query string** | Ningún endpoint lee header de autenticación. Sin ella: **401** |
| 6 | **Los 21 campos `bici*` desaparecen** si no hay bici | No llegan vacíos: no llegan. El mapeo debe tolerar la ausencia (caso del reel 6) |
| 7 | **Enfriamiento ~24 h del disparador de comentarios** (anti-spam de ManyChat, **no configurable**) | Un mismo contacto no re-dispara el mismo post en 24 h → **para probar, usar una cuenta virgen**. Un cliente nuevo dispara siempre |
| 8 | **`cf_oferta_enviada` sin chequear antes de B3** | Los dos caminos (escritura + delay de 40 s) se disparan casi juntos → **B3 duplicado** |
| 9 | **Mapear rutas anidadas** (`$.hero.fichaUrl`) | La UI de ManyChat no siempre las lee. Usar **siempre los campos planos de primer nivel** |

**Límites duros de Meta/Instagram:** máximo **3 botones** por mensaje · **~20 caracteres** por
botón (`Ver lo que hay ahora` = 20, justo en el borde) · la **ventana de 24 h** no se reabre
publicando un reel, solo con un mensaje de la persona o que toque un botón.

---

## §8 · Verificación E2E (antes de duplicar)

Con una **cuenta de Instagram virgen** (por el enfriamiento de 24 h):

1. Comentar el post con una de las 10 keywords.
2. **Airtable:** el Lead nace con `Canal origen = Comentario IG` **y el Interés tiene `Reel`**
   ← si falta el `Reel`, el `reel` del body está mal.
3. **DM:** B1 llega con el modelo real, no vacío.
4. Tocar el botón → **B2 con la foto, el puntaje, el estado honesto y el ahorro poblados.**
5. Esperar los 40 s → B3 llega **una sola vez**.
6. Dar un teléfono → B5 hace eco del número correcto.
7. `Correcto` → **`Llamados` tiene el ticket** con `Estado = Llamada pendiente`, `Origen = Bot DM`
   y el brief poblado (`Puntaje`, `Rango altura bici`, `Precio bici`, `Estado bici`).
8. **`Leads.Fecha teléfono` sellada** ← es la métrica #1 del negocio.
9. **A Luis le llegó el aviso** (plantilla `nuevo_llamado`).
10. Comentar **otra vez** con la misma cuenta → verificar la rama `dedup` (no debe crear un
    segundo ticket, y B6 no debe salir con el hueco).
11. **Borrar los registros de prueba por id.**

---

## §9 · Go-live

1. Rotar `MC_KEY` en Cloudflare + **redesplegar** + actualizar la llave en **todas** las
   Solicitudes externas de ManyChat.
2. Apagar las automatizaciones V1.
3. Borrar la opción **`Solo información`** del campo `Salida` en Airtable (a mano; la API no
   borra opciones). Mientras siga viva es una columna del Kanban que **no dispara nada, en
   silencio**.
4. Monitorear el primer día: `Leads.Fecha teléfono` es el indicador único de que el embudo
   V2 funciona. Meta: **20–30 %** de los leads entregan teléfono (semana 30 = 3 %).

---

## §10 · Correcciones que este runbook aplica sobre los documentos de diseño

Auditoría 2026-07-28. Cada punto se verificó contra el archivo real.

| Documento | Decía | Es |
|---|---|---|
| `V2_SALIDAS_LLAMADA.md` | «las 4 salidas»; «Agendamiento en tienda», «Solicitud de región» | Son **5** y los strings literales son `Visita agendada` y `Coordinación región`. La fuente de verdad es la const `SALIDAS` del código |
| `V2_SALIDAS_LLAMADA.md` §5 · `V2_PLAN_MIERCOLES` · `CLAUDE.md` §4 | «sin `Permiso WhatsApp` marcado NO se le escribe» | **No está implementado y es deliberado.** El código lo lee una sola vez y solo para propagar el opt-in. El test lo fija: «sin casilla de permiso: el mensaje SALE igual» |
| `MANYCHAT_REBUILD.md` §1.1 · `V2_DIA1_INSUMOS.md` §2 | «5 campos literales del backend» | Son **8**: faltan `cf_reagendo_datos`, `cf_agenda_hoy` y `cf_modelo` |
| `V2_PLANTILLA_COMENTARIOS.md` §3 | «18 campos», 13 `cf_bici_*` | Son **19** y **14**: falta `cf_bici_talla`, que su propio copy imprime |
| `CLAUDE.md` §2 · `EMBUDO.md` §11 | briefing a las **8 AM** | **9:00** (`cron-briefing.js:128`, hora pedida por Luis el 2026-07-10) |
| `V2_PLANTILLA_COMENTARIOS.md` §5.2 | «`mc-evento` escrito pero SIN desplegar» | **Ya está desplegado**; los 14 campos planos salen |
| `mc-waitlist.js` (cabecera) | `Estado = 'Nueva'` | El código escribe **`'Llamada pendiente'`** |
| `mc-match.js` (cabecera) | «en multi-opción NO crea Interés» | **Sí lo crea** (`hero = opciones[0]` → `match = true`) |
| El código de `salida-llamado` | «las 6 opciones del campo `Salida`» | En Airtable hay **7**: sigue viva `Solo información`, que no dispara nada |
| `EMBUDO.md` §6 · `cuaderno_montaje` | al duplicar hay que cambiar el **slug** de la ficha | Con `mc-evento` poblando `cf_bici_ficha` ya no hace falta — salvo que el flujo tenga un botón de URL fija |
| Varios | el recordatorio de **2 h** sale | **No sale**: `FLOW_NS_2H` está sin setear. En vivo salen 48 h y 8 am |
