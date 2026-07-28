# V2 · Puerta de DM — reconocimiento de intención

> Complementa a [`V2_PLANTILLA_COMENTARIOS.md`](V2_PLANTILLA_COMENTARIOS.md).
> Diseño 2026-07-27, **realineado a la ruta principal nueva: todo termina en la llamada**.
>
> Diferencia clave con la puerta de comentarios: allá **la bici se sabe** (la resuelve el
> shortcode del reel). Acá no se sabe nada — hay que averiguar qué quiere la persona antes
> de poder entregarle algo.

---

## 1 · Lo que cambió respecto del diseño anterior

El diseño previo hacía converger todo en «¿dónde estás?» → visita si Santiago, llamada si
región. **Eso se elimina.** Ahora:

- **La convergencia es una sola y es la llamada.** La ubicación la pregunta Luis («¿de qué
  comuna me hablas?»), que da mejor dato que un sí/no y no interroga a nadie por chat.
- **El bloque de convergencia es EXACTAMENTE el mismo que el de la puerta de comentarios**
  (B3→B6 de ese documento: oferta de llamada → teléfono → eco → `mc-llamado` → confirmación).
  Se monta una vez y las dos puertas lo invocan. Si mañana cambia el copy, cambia en un lugar.

```
DM libre → clasificar intención → entregar el valor de ESA intención → [convergencia: la llamada]
```

## 2 · Las 9 intenciones y qué hace el bot con cada una

Agrupadas por lo que el bot necesita para responder:

### Grupo A · Hay una bici de por medio → `mc-match` modo A
| # | Intención | Ejemplos reales del tráfico |
|---|---|---|
| 1 | Modelo específico | «tienen la Levo SL?» · «busco una Epic» |
| 2 | Precio de algo | «cuánto vale?» · «valor?» · «a cuánto la dejas» |
| 3 | Disponibilidad | «sigue disponible?» · «se vendió?» |

El endpoint ya tolera typos y palabras pegadas (corregido 2026-07-27 con bigramas: «Levo sl
swork» ahora calza). Devuelve ficha con puntaje, estado honesto y ahorro → **llamada**.

> Si la intención es de precio pero **no se sabe de qué bici** («cuánto vale?» a secas), no
> adivinar: `¿Cuál te interesa? Dime el modelo y te paso ficha y precio.` con salida al quiz.

### Grupo B · No sabe qué quiere → quiz (`mc-match` modo B)
| 4 | Asesoría | «qué me recomiendas» · «busco una para trail» · «ando en $3M» |

3 preguntas (uso · presupuesto · estatura) → recomendación → **llamada**.

### Grupo C · Quiere vender → `mc-consigna`
| 5 | Vender / parte de pago | «vendo mi bici» · «reciben la mía?» |

Captura los datos → crea la consignación → **llamada** (la tasación se conversa, no se
cotiza por chat). Es la prioridad #2 de Roberto: «si no lo tenemos, te lo buscamos» tiene
como gemelo «si tienes una, te la recibimos».

### Grupo D · Pregunta informativa → texto del documento
| 6 | Envíos a regiones | «despachan a Concepción?» |
| 7 | Garantía | «qué garantía tienen?» |
| 8 | Pagos / cuotas | «se puede en cuotas?» · «aceptan transferencia?» |
| 9 | Ubicación / horario | «dónde están?» · «a qué hora abren?» |

Responde corto y concreto → **llamada**.

> **La 9 es señal de compra, no una consulta.** Quien pregunta dónde están quiere ir. Va
> directo a la convergencia, sin rodeos.

## 3 · Lo que espera los documentos de Roberto — y por qué NO bloquea el lanzamiento

Solo el **Grupo D** depende de textos que Roberto tiene que escribir (envíos, garantía,
pagos, recompra). Los grupos A, B y C usan endpoints que ya funcionan y están verificados.

**El fallback de las rutas informativas es la llamada misma:**
```
Eso te lo explica mejor Luis en dos minutos que yo por acá 🙂

¿Te llamamos y de paso te resuelve todo lo demás?
```
O sea: **la puerta de DM puede salir sin los documentos.** Sin ellos el bot deriva antes; con
ellos responde primero y deriva después (que convierte mejor, porque entrega valor antes de
pedir). Los documentos son una mejora, no un requisito.

| Ruta | Estado |
|---|---|
| Modelo específico · Precio · Disponibilidad | ✅ lista |
| Asesoría / quiz | ✅ lista |
| Vender | ✅ lista |
| Envíos · Garantía · Pagos · Recompra | 🔧 texto de Roberto (con fallback funcionando) |

## 4 · Reglas del clasificador

1. **El precio no es una intención, es un modificador.** «Cuánto vale la Levo» es intención
   de modelo con pregunta de precio, no una ruta aparte. Si no, colisiona con todo.
2. **Prioridad máxima al opt-out.** Las palabras de baja se evalúan **antes** que cualquier
   otra regla, siempre.
3. **Si no clasifica, no inventar.** Fallback honesto que además captura el texto para
   revisarlo semanalmente — ese balde es el motor de mejora del clasificador:
   ```
   Cuéntame un poco más y te ayudo 🙂 ¿Andas buscando una bici en particular, quieres que te
   ayudemos a elegir, o tienes una para vender?
   ```
   (3 botones + guardar lo que escribió en `cf_mensaje`, con tag `intencion_no_reconocida`.)
4. **Nunca elegir por la persona.** Si el modelo calza con varias, mostrar las coincidencias
   y que elija. `mc-match` ya devuelve `otrasTexto` listo para pegar.
5. **Audio, foto o sticker** → no romper. El audio tiene salida propia y es la mejor de todas:
   ```
   No puedo escuchar audios por acá, pero Luis sí — de hecho es más rápido que te llame.
   ```

## 4-bis · Anti-bucle y traspaso a humano

> El modo de falla más caro de un bot conversacional no es equivocarse: es **insistir**. Una
> persona que recibe dos veces el mismo «cuéntame un poco más» ya no vuelve.

### La regla de los dos golpes

Todo bloque que espera una respuesta lleva **contador y salida**. Nunca se repite un mensaje
de aclaración más de una vez.

| Intento | Qué hace el bot |
|---|---|
| **1º no reconocido** | Pide aclaración **una sola vez**, con 3 botones (que siempre son salida garantizada) |
| **2º no reconocido** | **Deja de intentar**: avisa a Luis, pasa a modo humano y **se calla** |

```
cf_no_reconocido = contador  ·  cf_modo_humano = si/no  ·  cf_mensaje = lo que escribió
```

**Mensaje del 1º:**
```
Cuéntame un poco más y te ayudo 🙂

¿Andas buscando una bici en particular, quieres que te ayudemos a elegir, o tienes una para vender?
```
**Botones:** `Busco una bici` · `Ayúdenme a elegir` · `Quiero vender`

**Mensaje del 2º (el último del bot):**
```
Prefiero que te responda alguien del equipo y no hacerte perder el tiempo 🙌

Le avisé a Luis, te responde por acá en un rato.
```
→ acción **Notificar al administrador** + **Pausar automatizaciones 24 h**.

### El aviso a Luis
Usar la acción nativa de ManyChat **«Notificar al administrador»**: llega al Inbox y a la app,
**no necesita plantilla ni aprobación de Meta**. Es además donde Luis va a responder, así que
el aviso y la acción viven en el mismo lugar.
*(Si más adelante se quiere el aviso por WhatsApp, ahí sí hay que crear plantilla nueva:
`nuevo_llamado` no sirve, dice «Llamado pendiente» y sería engañoso.)*

### El modo humano y cómo se sale de él

Mientras `cf_modo_humano = si`, **el bot no responde nada**, aunque reconozca la intención.
Es a propósito: si Luis está conversando con la persona, un bot que se mete encima arruina la
conversación y descoloca al lead.

**Se sale de tres maneras:**
1. **Automática a las 24 h** — la pausa expira sola. Es la red de seguridad: si Luis no
   alcanzó a responder, el bot no queda muerto para siempre.
2. **Luis la libera** desde el Inbox cuando termina de atender.
3. **Reset del contador** — cuando llega un mensaje que **sí** se clasifica, `cf_no_reconocido`
   vuelve a 0. Así la próxima consulta se rutea sola, sin arrastrar el historial de fallas.

> **DECIDIDO (Gabriel, 2026-07-27): el bot NO retoma dentro de las 24 h**, aunque reconozca
> la intención. Mientras `cf_modo_humano = si`, el bot está en silencio y Luis manda. Se
> descartó la alternativa (retomar apenas entienda algo) porque con el volumen actual
> —5 sin ruta en la semana 30— el costo de esperar es bajo y el de interrumpir una
> conversación humana en curso es alto. Reversible con un switch si el volumen crece.

### El balde de fallos = el motor de mejora
Todo mensaje no reconocido se guarda en `cf_mensaje` con tag `intencion_no_reconocida`.
Revisarlo **una vez por semana** y convertir lo que se repita en una intención nueva o en
ejemplos de entrenamiento. En 4–6 semanas ese balde debería vaciarse solo.

### Donde más aplica la misma regla
- **Captura del teléfono** (puerta de comentarios, B4): 2 reintentos y luego salida lateral
  («si prefieres, te mando la ficha por acá»). Nunca un tercer «no te entendí el número».
- **Audio, foto o sticker**: no cuenta como intento fallido — tiene su propia salida
  («no puedo escuchar audios, pero Luis sí»), que además es de las que mejor convierten.

## 5 · Diferencias de montaje con la puerta de comentarios

| | Comentarios | DM |
|---|---|---|
| Disparador | comentario con 1 de 10 palabras clave | mensaje directo o respuesta a historia |
| ¿Se sabe la bici? | **sí**, vía shortcode del reel | no, hay que clasificar |
| Primer mensaje | terminal → **obligatorio botón de flujo** | normal, la persona ya escribió |
| `mc-evento` | con `reel` | con `bici` si se resolvió, o sin bici |
| `Canal origen` | `Comentario IG` | `DM IG` |
| Convergencia | **la misma** | **la misma** |
| Se duplica ×6 | sí | **no, es única** |

> La puerta de DM **no se duplica**: es una sola automatización para todo el tráfico directo.
> Por eso conviene montarla después de la de comentarios — el 81 % de los leads de la semana
> 30 llegó por comentario.

## 6 · Lo que falta para dejarla lista para deployar

1. **Los 4 textos de Roberto** (o lanzar con el fallback del §3).
2. ~~Confirmar la IA de intención~~ ✅ **CONFIRMADA** (2026-07-27): el plan de ManyChat la
   incluye. Era el único riesgo de plataforma del montaje.
3. **La convergencia ya montada** en la puerta de comentarios (se reutiliza tal cual).
4. **Los campos del anti-bucle** (§4-bis): `cf_no_reconocido` · `cf_modo_humano` · `cf_mensaje`.
