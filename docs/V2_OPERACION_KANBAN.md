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

## 3 · Qué ve en cada tarjeta

**Al frente, sin abrir** (para decidir a quién llamar primero):
`Nombre` · `Teléfono` · bici de interés · **minutos esperando**

**Al abrirla — el brief, solo lectura:**
`Puntaje` · `Rango altura bici` · `Precio bici` · `Estado bici` · `Notas` (lo que escribió)

> `Estado bici` es la guarda contra el peor error posible: ofrecer una unidad ya vendida.

**Al abrirla — lo editable, en este orden** (es el orden del guion de la llamada):
`Ciudad` → `Estatura (cm)` → `Fecha y hora de visita` → `Permiso WhatsApp` →
`Próximo paso` → `Intentos` → `Notas`

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
