# V2 · Las 4 salidas de la llamada

> Diseño de Gabriel, 2026-07-27. **Luis marca la salida en su pantalla y eso dispara el
> mensaje automático.** Un solo campo (`Salida` en la tabla `Llamados`) gobierna todo lo que
> pasa después de colgar. Si Luis no marca nada, no sale nada: el registro ES la acción.

---

## 1 · El mapa

| Salida que marca Luis | Mensaje que sale | Plantilla | Estado |
|---|---|---|---|
| **Agendamiento en tienda** | confirmación + recordatorios 48 h y 2 h; si reagenda, aviso de reagendo | `confirmacion_visita` · `recordatorio_48h` · `recordatorio_2h` · `visita_reagendada` | ✅ aprobadas y **el motor ya corre** |
| **Encargo de búsqueda** | «recibimos tu solicitud, te avisamos apenas la encontremos» | `encargo_recibido` | ✅ aprobada — **verificar el texto** (§3) |
| **Solicitud de región** | «estamos gestionando tu pedido» | `region_gestionando` | 🆕 **crear** |
| **No contestado** | presentación + curiosidad (llega de un número desconocido) | `llamada_no_contestada` | 🆕 **crear** |

**Solo faltan 2 plantillas nuevas.** Meta las aprueba normalmente en minutos (hasta 24 h),
así que enviándolas hoy llegan al miércoles.

## 1-bis · Las 2 plantillas al STAFF que hay que rehacer

Ambas quedaron con texto fijo que el V2 dejó obsoleto. **No se arreglan metiendo
contenido en el custom field: el problema está en la parte fija.**

### `nuevo_llamado` — la frase manda a mirar algo que ya no existe
```
📞 Llamado pendiente: {cf_llamado_datos}. Contacta a la persona en la franja indicada.
```
❌ **En V2 no hay franja.** Al lead no se le pregunta cuándo prefiere que lo llamen: deja su
número y se le llama lo antes posible dentro del horario. La frase manda a Luis a buscar un
dato que el ticket no tiene.

✅ Reemplazo propuesto (`nuevo_llamado_v2`, **Utility**):
```
📞 Nuevo llamado pendiente: {{1}}

Llámalo lo antes posible — la persona pidió que la contactaran.
```

### `briefing_diario` — el título ya no describe el contenido
```
☀️ Buenos días. Visitas de HOY en Bike Trust: {cf_agenda_hoy}

Gracias.
```
❌ El briefing ahora abre con la **cola de llamados pendientes** (lo accionable a primera
hora, y la única red que atrapa los leads que entraron fuera de horario). Un mensaje
titulado «Visitas de HOY» que arranca listando llamados se lee mal.

✅ Reemplazo propuesto (`briefing_diario_v2`, **Utility**) — título neutro que no vuelve a
quedar obsoleto cuando cambie el contenido:
```
☀️ Buenos días. Tu resumen de hoy en Bike Trust:

{{1}}
```

> **Hacer v2 y no editar las actuales.** Editar el texto manda la plantilla a revisión y
> **mientras está en revisión no se puede usar**: si se edita `briefing_diario` esta noche,
> mañana a las 9:00 puede no salir nada. Con una v2 el sistema sigue funcionando con la
> vieja y se cambia la variable `FLOW_NS_*` cuando la nueva esté aprobada. Cero interrupción.
> Es el mismo patrón que ya usaron con `confirmacion_visita` → `confirmacion_visita_v2`.

## 2 · Plantillas que NO hay que botar (siguen sirviendo)

Nacieron del diseño viejo pero calzan igual con el nuevo:

- **`reactivacion_stock`** (Marketing) — es el **cierre natural del encargo de búsqueda**:
  «te lo buscamos» → *llegó*. Sin ella, la promesa principal del negocio queda sin final.
- **`seguimiento_noshow`** (Marketing) — agendó y no llegó. El caso sigue existiendo.
- **`briefing_diario`** · **`nuevo_llamado`** · **`nueva_solicitud`** · **`nueva_oferta_bici`**
  — avisos internos al equipo, todos vigentes.

**Las que sí quedan huérfanas del diseño viejo:** `seguimiento_suelto` y `recordatorio_final`.
No hay que borrarlas (no cuesta nada tenerlas), pero **no se conectan** a este embudo.

## 3 · Verificar antes de usar: `encargo_recibido`
Se redactó para el botón «Consíganmela» del bot. Hay que abrir su cuerpo y confirmar que el
texto sirve también cuando el encargo nace **de una llamada**. Si dice algo como «recibimos
tu encargo, te avisamos apenas entre una», sirve tal cual. Si menciona el chat o el bot, hay
que crear una variante. **Editar el texto la manda de vuelta a revisión.**

---

## 4 · Las dos plantillas nuevas

### 4.1 · `region_gestionando` — categoría **Utility**
*(Es un mensaje de servicio sobre una gestión que la persona pidió, no promoción.)*

```
Hola {{1}}, ya quedó todo registrado 📋

Estamos gestionando tu pedido de la {{2}} y coordinando el despacho a tu ciudad. Te escribo por acá apenas tenga novedades.

Cualquier duda, respóndeme a este mismo mensaje.
```
`{{1}}` nombre · `{{2}}` modelo de la bici.

> Esta persona **sí contestó** la llamada, así que ya sabe quién es Luis: no hace falta
> presentarse de nuevo. Lo que necesita es saber que su caso está vivo y que hay alguien
> moviéndolo.

### 4.2 · `llamada_no_contestada` — categoría **Utility**
*(Es seguimiento de una llamada que la persona misma solicitó.)*

```
Hola {{1}}, soy Luis de Bike Trust 👋 Te llamé recién por la {{2}} y no te pillé.

En 5 minutos te digo si es la que te conviene o si mejor esperas otra, y si quieres te la aparto mientras lo decides.

¿Te llamo más tarde o lo vemos por acá?
```
`{{1}}` nombre · `{{2}}` modelo de la bici.

> **Este es el único mensaje que llega de un número que la persona no conoce.** Por eso:
> 1. **Se identifica en la primera línea** — en Chile el 87 % no contesta números
>    desconocidos y el 38 % de esas llamadas son cobranza. Sin nombre y motivo en el primer
>    renglón, se lee como spam y se bloquea.
> 2. **Ofrece en vez de pedir** — el apartado es un servicio concreto, gratis y sin
>    compromiso. Un mensaje que da algo se responde mucho más que uno que reclama atención.
> 3. **«o si mejor esperas otra»** es la frase clave: ningún vendedor común la diría. Es la
>    misma señal de honestidad que ya vendes con el puntaje y el estado honesto, aplicada al
>    canal. Y cierra ofreciendo **las dos vías** —llamada o chat— para que el lead elija.
>
> ⚠️ **Descartado a propósito: «hay detalles que no van en la ficha».** Contradice la
> propuesta de valor entera. Todo el diferenciador de Bike Trust es que la ficha lo dice
> TODO, incluidos los defectos; insinuar que hay información reservada rompe exactamente eso.
> La razón para hablar tiene que ser algo que la ficha **no puede** dar por definición —si la
> bici es la correcta *para esa persona*— no algo que se le esté escondiendo.
>
> **Variante con escasez** (`es la única que tengo en esa talla`): más potente, pero solo si
> es verdad en ese momento y la plantilla no puede verificarlo sola. Dejarla fuera del texto
> fijo; que Luis la use en la llamada, donde sí sabe si es cierto.

> ⚠️ **El permiso para este mensaje se otorga antes**, en el bloque de confirmación del bot:
> *«Si no te pilla, te deja un WhatsApp a ese mismo número.»* Sin esa línea, escribirle a
> alguien que dio su teléfono para una llamada sería usar el consentimiento de un canal en
> otro. Es la razón por la que esa frase no se puede sacar del copy.

---

## 5 · El mecanismo

**Disparador:** en Airtable, `Llamados.Salida` cambia de valor.
**Acción:** llamar a un endpoint nuevo `POST /api/salida-llamado` (patrón `mc-*`, con `MC_KEY`).

El endpoint hace lo mismo que ya hace `cron-recordatorios`:
1. Lee el ticket y resuelve el `MC subscriber id` del lead.
2. Elige el flujo según `Salida` (env `FLOW_NS_REGION`, `FLOW_NS_NO_CONTESTA`, `FLOW_NS_ENCARGO`).
3. Escribe los campos que la plantilla imprime (`cf_bici`, etc.) con `setCustomFieldByName`.
4. Dispara el flujo con `sendFlow`.

**Guardas obligatorias:**
- **Idempotencia — SOLO del mensaje (afinada 2026-08-05):** campo `Aviso salida enviado`
  (dateTime) en `Llamados`. Si ya tiene valor, el WhatsApp no se reenvía — pero los DATOS
  del lead sí se refrescan siempre: las bicis elegidas después de la fecha llegan igual a
  `MC bici`, y un reagendo por teléfono copia la fecha nueva y re-arma los recordatorios
  (los sellos de recordatorio solo se limpian si la fecha CAMBIÓ).
- **Permiso:** para `Agendamiento`, `Encargo` y `Región` exigir `Permiso WhatsApp = ✓`
  (lo marca Luis en la llamada). **`No contestado` es la excepción**: no hubo llamada donde
  pedirlo, y el permiso viene del bloque de confirmación del bot (§4.2).
- **Si falla,** que el error se avise al staff. Hoy los fallos de envío mueren dentro de un
  JSON que nadie mira — es el modo de falla más silencioso del sistema.

## 6 · Lo que hay que hacer

1. **Crear las 2 plantillas** en ManyChat y enviarlas a revisión (§4). Categoría **Utility** ambas.
2. **Verificar el cuerpo de `encargo_recibido`** (§3).
3. **Agregar `No contestado` al campo `Salida`** (a mano en Airtable: la API no agrega
   opciones a un select existente).
4. **Agregar el campo `Aviso salida enviado`** (dateTime) para la idempotencia.
5. **Construir `/api/salida-llamado`** + setear los 3 `FLOW_NS_*` nuevos en Cloudflare.
6. **Conectar la automatización** de Airtable al endpoint.
