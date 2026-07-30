# Guía de operación por rol — Embudo V2

> Una página por rol. El guion de qué DECIR en la llamada es
> [`V2_GUION_LLAMADA.md`](V2_GUION_LLAMADA.md); esta guía es qué HACER en el sistema.
> El mapa del embudo para no-técnicos: `embudo_comentarios_v2_para_duenos.svg`.

---

## 📞 LUIS — tu página

**Tu pantalla es una sola:** la interfaz **«Operación Llamadas (V2)»** en Airtable.
Todo lead que entregó su teléfono aparece ahí como una tarjeta. Tu trabajo entero es:
**llamar y arrastrar la tarjeta a una columna. El sistema hace el resto** (mensajes
automáticos, recordatorios, tickets).

### El ciclo, paso a paso

1. **Te llega un WhatsApp** «nuevo llamado» → abre la pantalla **1 · Llamadas**.
2. **Llama al de más arriba** de la columna 📞 *Llamada pendiente* (está ordenada: el que
   lleva más tiempo esperando, primero). La tarjeta ya trae el brief: bici, puntaje,
   rango de altura, precio y si sigue disponible. **No anotes nada mientras hablas.**
3. Al colgar, **arrastra la tarjeta a UNA columna**:

| Arrastra a… | Cuándo | Qué pasa solo |
|---|---|---|
| 🏬 **Visita agendada** | Vive en Santiago y viene a la tienda | Confirmación + recordatorios por WhatsApp *(recién cuando pongas la fecha — paso 4)* |
| 📍 **Coordinación región** | Fuera de Santiago y la bici que quiere SÍ está | Le llega «estamos gestionando tu pedido» |
| 🔎 **Encargo de búsqueda** | **No tenemos lo que busca — viva donde viva** | Le llega «recibimos tu solicitud» y nace el ticket de búsqueda |
| ↩️ **No contestado** | No contestó | Le llega tu WhatsApp de «te llamé y no te pillé»; la tarjeta vuelve a la cola |
| ✖️ **Sin interés** | Habló y no va a avanzar | Nada. Anota el motivo real en `Notas` |

**La regla que decide** (el error común es mirar la ciudad primero):
¿Tenemos la bici que quiere? **NO → Encargo de búsqueda** (aunque sea de región).
**SÍ** → ¿Santiago? → Visita. ¿Región? → Coordinación región.

4. **Completa el caso en su pantalla** (después de colgar, no durante):
   - **Visita** → pantalla **2 · Visitas**: pon **fecha y hora** ⚠️ *sin fecha NO le llega
     la confirmación al cliente* — y elige las **1–3 bicis** que vas a tener listas.
   - **Encargo** → pantalla **4 · Búsquedas**: completa modelo, talla, presupuesto.
   - **Región** → pantalla **3 · Región**: comuna y estado del despacho.

### Las 3 reglas de oro
1. **Un gesto:** durante la llamada solo decides la columna. Todo lo demás, al colgar.
2. **Nunca ofrezcas una bici sin mirar `Estado bici`** en la tarjeta (puede estar vendida).
3. Si alguien llega **por teléfono directo o camina a la tienda**, créale su tarjeta con el
   formulario **«➕ Nuevo llamado»** — si no está en el sistema, no existe.

---

## 👔 ROBERTO Y ALFONSO — su página

**Su vista es el mismo Kanban de Luis, compartido en solo lectura.** De un vistazo:

- **Cuántas tarjetas hay en 📞 Llamada pendiente** = leads esperando llamada ahora.
- **La tarjeta más vieja de esa columna** = si el SLA de respuesta se está cumpliendo
  (la espera en minutos está en cada tarjeta).
- **El tamaño de 🔎 Encargo de búsqueda** = cuánta demanda hay que salir a sourcear.
- **El abanico completo** = qué produjo el embudo esta semana.

**Avisos que les llegan por WhatsApp:** cada encargo que pasa a «Buscando» (trazabilidad
del sourcing) y las consignaciones nuevas (Roberto opera esas desde la página de
Consignaciones, no desde el Kanban).

**La métrica #1 del negocio** es `Fecha teléfono` (cuántos leads entregan su número).
Meta acordada: **20–30 %** (semana 30 = 3 %). Se mira en el tablero semanal, con
comparativo entre semanas.
