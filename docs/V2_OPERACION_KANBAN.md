# V2 · La pantalla de Luis — un Kanban, un gesto

> Diseño de Gabriel, 2026-07-27. **Luis se mueve en UNA sola pantalla.**
> Arrastrar la tarjeta **es** marcar la salida **es** disparar el mensaje automático.
> No hay un segundo paso que se pueda olvidar.

---

## 1 · La idea

No es un pipeline lineal. Es **una cola que se abre en abanico**: todo entra por la primera
columna y sale por una de las cinco siguientes, según cómo haya terminado la llamada.

```
┌──────────────┐
│ 📞 PENDIENTE │ ──┬──► 🏬 Visita agendada      → confirmación + recordatorios
│   (la cola)  │   ├──► 📍 Coordinación región  → «estamos gestionando tu pedido»
│              │   ├──► 🔎 Encargo de búsqueda  → «recibimos tu solicitud» + CREA el ticket
│              │   ├──► ↩️  No contestado          → mensaje de rescate · vuelve a la cola
│              │   └──► ✖️  Sin interés          → nada
└──────────────┘
```

## 2 · El campo que manda: `Salida`

**Un solo campo gobierna el Kanban y todo lo que pasa después.** La tarjeta nace en
`Llamada pendiente` y Luis la arrastra a donde corresponda.

| Columna | Cuándo | Qué dispara al soltar la tarjeta |
|---|---|---|
| **📞 Llamada pendiente** | La crea el bot al capturar el teléfono. Ordenada por antigüedad: **arriba el que lleva más esperando**. | — |
| **🏬 Visita agendada** | Vive en Santiago y viene a la tienda | Confirmación + recordatorios 48 h y 2 h · **copia la visita al Lead** (sin eso el motor no la ve) |
| **📍 Coordinación región** | Fuera de Santiago | Mensaje de gestión · queda para coordinar despacho |
| **🔎 Encargo de búsqueda** | No tenemos lo que busca | Mensaje de recibido · **crea el ticket en `Solicitudes`** y de ahí pasa a la otra pantalla |
| **↩️ No contestado** | No se pudo hablar | Mensaje de rescate · **el ticket sigue abierto**: es la bandeja de reintentos, no un cierre |
| **✖️ Sin interés** | Habló y no va a avanzar | Nada. Se anota el motivo real en `Notas` |

### La regla que decide la salida (y evita el error más común)

Lo que decide NO es dónde vive la persona: es **si tenemos o no la bici que quiere**.

```
¿Tenemos la bici que quiere?
├── NO  →  🔎 ENCARGO DE BÚSQUEDA          (viva donde viva)
└── SÍ  →  ¿de dónde es?
          ├── Santiago  →  🏬 VISITA AGENDADA
          └── región    →  📍 COORDINACIÓN REGIÓN
```

**Un lead de región que busca algo que no tenemos NO es una coordinación de región: es un
encargo de búsqueda.** «Región» solo aplica cuando hay una unidad concreta del inventario que
coordinar y despachar. Si no hay bici, no hay nada que coordinar todavía — lo que hay es algo
que salir a buscar, y eso vive en la cola de sourcing. La región queda anotada en `Ciudad` y
viaja a las notas del encargo, para que al conseguirla ya se sepa que hay despacho de por medio.

### Las bicis que Luis prepara para la visita

`Bici de interés` es **la del reel** (por dónde entró) y la pone el bot.
**`Bicis para la visita`** es **lo que Luis va a tener listo** cuando la persona llegue: de 1
a 3 modelos, elegidos en la llamada. Casi nunca son lo mismo — alguien entra por la Levo y en
la conversación aparece que también le sirve la Epic.

Al marcar `Visita agendada`, esos modelos se copian al Lead y con eso **salen solos en el
briefing de la mañana y en los recordatorios de WhatsApp**, sin que nadie mantenga dos listas.
Si Luis no elige ninguna, cae a la bici del reel: siempre hay algo que preparar.

> El tope de 3 es de criterio, no técnico: más de tres bicis en la vitrina deja de ser una
> visita preparada y pasa a ser un recorrido. Airtable no lo limita solo.

> ⚠️ **`Llamada pendiente` tiene que ser una opción de `Salida`**, no solo de `Estado`.
> Hoy el campo `Salida` no la tiene y hay que agregarla a mano (la API no agrega opciones a
> un select existente). Sin eso las tarjetas nuevas nacen sin columna.

### Qué pasa con el campo `Estado`
`Estado` (`Llamada pendiente / Llamado / Cerrada`) **deja de ser cosa de Luis** y pasa a ser
interno: lo mantiene el endpoint `salida-llamado` en sincronía con la salida. Existe porque
lo usan tres cosas ya construidas: el sello de `Fecha primera llamada`, la cola del briefing
y el dedup de `mc-llamado`.

| Salida | → `Estado` |
|---|---|
| Visita agendada · Región · Encargo · Sin interés | `Llamado` |
| **No contestado** | **`Llamada pendiente`** (vuelve a la cola de reintentos) |

**Regla de oro: Luis toca UN campo.** Todo lo demás lo deriva el sistema.

## 2-bis · El principio que ordena todo: CLASIFICAR ≠ COMPLETAR

**El primer Kanban es solo para identificar el tipo de petición y mover la tarjeta.**
Nada de formularios en medio de una llamada: mientras Luis habla, lo único que hace es
decidir a qué columna va. El detalle se completa después, **en la pantalla de cada caso**.

```
LLAMADA  →  Kanban de Llamados        →  pantalla del caso
            (¿qué tipo de petición?)      (completar lo que corresponda)

🏬 Visita   → vista «Visitas»      → fecha y hora · las 1-3 bicis a preparar
📍 Región   → vista «Región»       → coordinación del despacho
🔎 Encargo  → tabla `Solicitudes`  → modelo · talla · presupuesto · uso
↩️ No contestó → vuelve a la cola  → (nada que completar)
✖️ Sin interés → cerrado           → el motivo, en Notas
```

Las tres primeras son **vistas filtradas de la misma tabla** por el campo `Salida` — no son
tablas nuevas. Así el ciclo de vida de la llamada vive en un solo lugar y cada pantalla
muestra solo los campos que ese caso necesita.

### La consecuencia que hubo que resolver
Si Luis clasifica una visita **antes** de acordar la fecha, no hay nada que confirmarle al
cliente todavía. El endpoint lo maneja así: **clasifica, sincroniza el estado y NO sella**.
Cuando Luis completa «Fecha y hora de visita» en la vista de Visitas, el mismo endpoint corre
de nuevo y **ahí sí sale la confirmación** con los recordatorios enganchados.

> El costo es que la confirmación puede salir unos minutos después de colgar, en vez de al
> instante. A cambio, Luis no llena formularios mientras la persona le habla — que es donde
> se pierden los datos y se enfrían las llamadas. Es el intercambio correcto.

## 3 · Qué ve en cada tarjeta

**Al frente, sin abrir** (para decidir a quién llamar primero):
`Nombre` · `Teléfono` · bici de interés · **minutos esperando**

**Al abrirla — el brief, solo lectura:**
`Puntaje` · `Rango altura bici` · `Precio bici` · `Estado bici` · `Notas` (lo que escribió)

> `Estado bici` es la guarda contra el peor error posible: ofrecer una unidad ya vendida.

**Editable durante la llamada: NADA.** El primer Kanban es de solo lectura salvo el arrastre.
Luis escucha, decide el tipo de petición y mueve la tarjeta. Punto.

> **Por qué ni la ciudad ni el permiso se anotan acá:**
> - **La ciudad es redundante**: la columna a la que arrastra *ya dice* si es Santiago o
>   región. Escribirla de nuevo es pedir el mismo dato dos veces. Donde sí hace falta el
>   detalle —qué comuna, para el despacho— es en la pantalla de Región, no en la llamada.
> - **El permiso de WhatsApp no lo pide Luis**: lo captura el bot al pedir el número. El
>   mensaje de confirmación declara literalmente *«si no te pilla, te deja un WhatsApp a ese
>   mismo número»*, y la persona entrega el teléfono después de leer eso. Depender de que
>   Luis se acuerde de preguntarlo en cada llamada era frágil: un olvido y ese lead se
>   quedaba sin confirmación ni recordatorios, sin que nadie se enterara.

## 4 · La cadena completa hasta la otra pantalla

Esto es lo que cierra el circuito que planteaste:

```
Luis arrastra a 🔎 Encargo de búsqueda
        ↓
salida-llamado crea el registro en `Solicitudes`
   (modelo buscado · contacto · link al Lead · Estado = Llamada pendiente)
        ↓
aparece en la PANTALLA DE SOLICITUDES (la cola de sourcing)
        ↓
alguien lo mueve a `Buscando`
        ↓
cron-sourcing avisa por WhatsApp a Roberto y Alfonso
        ↓
cuando la bici entra → `reactivacion_stock` al cliente
```

✅ **La cadena está completa (2026-07-27).** `salida-llamado` crea el registro en `Solicitudes`
con lo que Luis anotó, lo enlaza de vuelta al ticket y lo deja en la cola de sourcing.

**Lo que Luis tiene que llenar** al marcar esta salida: el campo **`Modelo buscado`** del
ticket. Si lo deja vacío el encargo igual nace, marcado como `(por confirmar con el cliente)`
— es mejor una cola con un ticket incompleto que un encargo perdido.

El link `Solicitud` del ticket es a la vez trazabilidad y **guarda anti-duplicado**: mientras
esté vacío un reintento vuelve a crear el ticket; una vez escrito, nunca más.

## 4-bis · Qué pasa DESPUÉS de cada salida (el sistema de tickets)

Hay **tres tablas** y cada una es una cola distinta. Un lead puede pasar por más de una.

| Tabla | Qué es | Quién la abre | Cuándo se cierra |
|---|---|---|---|
| **`Llamados`** | La cola de llamadas. **Es el Kanban de Luis.** Todo lead que entrega su teléfono entra acá. | El bot (`mc-llamado`) | Al marcar una salida (salvo `No contestado`, que vuelve a la cola) |
| **`Solicitudes`** | La cola de **sourcing**: qué hay que salir a buscar. | `salida-llamado` al marcar Encargo, o el staff a mano | Cuando la bici se consigue y el cliente decide |
| **`Consignaciones`** | Bicis que **nos ofrecen**. Otra línea del negocio, no toca este flujo. | `mc-consigna` | Al aceptar o rechazar |

### El recorrido completo, salida por salida

**🏬 Visita agendada** → se escribe `Fecha visita` y el estado en el **Lead**, y con eso se
enciende solo todo lo que ya existía: confirmación inmediata, recordatorio 48 h y recordatorio
de la mañana. Las bicis a preparar salen en el briefing. El ticket se cierra.
*El disparador de toda esa cadena es el cambio de estado que hace Luis* — exactamente el
modelo que planteaste: el bot ya no agenda nada, la cadena arranca desde el registro humano.

**📍 Coordinación región** → mensaje de gestión al cliente. El ticket queda abierto hasta
coordinar el despacho de **una unidad concreta** (si no hay unidad, es un encargo).

**🔎 Encargo de búsqueda** → **nace un registro en `Solicitudes`** enlazado al ticket y al
Lead. Nace **casi vacío a propósito**: solo con lo que se sabe (qué busca, teléfono, ciudad,
estatura y las notas de la llamada). Luis lo completa —talla, presupuesto, motorización,
disciplina— **durante la misma llamada o al colgar**, porque esa información sale conversando,
no de un formulario. De ahí en adelante corre solo: `Buscando` → aviso a Roberto y Alfonso →
cuando entra la bici, `reactivacion_stock` al cliente.

**↩️ No contestado** → mensaje de rescate y **el ticket vuelve a la cola**. No es un cierre.

**✖️ Sin interés** → cierra sin mandar nada. El motivo real va en `Notas`.

## 5 · La vista de los dueños

**El mismo Kanban, compartido en solo lectura con Roberto y Alfonso.** No hay que construir
nada aparte: es la misma pantalla con permiso de lectura.

Lo que ellos leen de un vistazo, sin preguntarle nada a nadie:
- **Cuántas tarjetas hay en la primera columna** = cuántos leads esperan llamada
- **Hace cuánto está la más vieja** = si el SLA se está cumpliendo
- **Cómo se reparte el abanico** = qué está produciendo el embudo esta semana
- **El tamaño de la columna de encargos** = cuánta demanda hay que salir a buscar

> Cuando el tablero tenga vista en vivo (la URL única que pidió Roberto), este mismo Kanban
> se replica ahí. Mientras tanto, compartir la interfaz de Airtable en modo lectura cuesta
> cero y entrega el 100% del valor.

## 6 · Higiene: que el Kanban no se llene

Un Kanban sin límite se vuelve ilegible en un mes. **Filtro de alcance de la página:**
ocultar las tarjetas cerradas hace más de 14 días (Sin interés, y las de Visita/Región/Encargo
ya resueltas). El histórico completo sigue en la tabla y en el tablero; la pantalla de Luis
es para **trabajar**, no para archivar.

## 7 · Qué falta para montarlo

| # | Qué | Dónde |
|---|---|---|
| 1 | Agregar **`Llamada pendiente`** y **`No contestado`** a las opciones de `Salida` | Airtable, a mano (la API no agrega opciones) |
| 2 | Crear la página Kanban sobre `Llamados`, agrupada por `Salida` | Se puede crear por API |
| 3 | ~~Que `salida-llamado` cree el registro en `Solicitudes`~~ | ✅ **hecho 2026-07-27** (probado) |
| 4 | ~~Que `salida-llamado` sincronice `Estado`~~ | ✅ **hecho 2026-07-27** (probado) |
| 5 | Crear la pantalla de **Solicitudes** (cola de sourcing) | Se puede crear por API |
| 6 | Confirmar que **Luis tiene asiento con permiso de edición** | Airtable — **bloqueante** |
| 7 | Compartir la interfaz en lectura con Roberto y Alfonso | Airtable |
