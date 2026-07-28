# V2 · Plan al miércoles 2026-07-29

> Aprobado por Roberto el 2026-07-27. Objetivo doble:
> **(1) Puerta de comentarios EN VIVO de punta a punta** · **(2) Puerta de DM lista para deployar**, esperando solo los textos de los documentos de Roberto.
>
> Meta del dueño: **20–30 % de los leads entregan teléfono** (hoy 1 de 31 = 3 %). Semana 30 = semana base.

---

## El embudo nuevo, en una línea

```
comentario (10 palabras clave)
   → mc-lead  → mc-evento (devuelve la bici en campos planos)
   → DM: puntaje + dónde perdió + estado honesto + ahorro
   → "¿te llamamos?"  → teléfono  → mc-llamado (ticket)
   → aviso WhatsApp a Luis  → Luis llama con el brief en pantalla
   → Luis marca la SALIDA: visita · región · encargo
```
La pregunta de ubicación **desaparece del bot**: es irrelevante si igual va a hablar con el especialista. La levanta Luis preguntando la comuna.

---

## 1 · Backend — ✅ HECHO (2026-07-27)

**`mc-evento` ahora devuelve la bici en campos planos.** Era el bloqueo: antes solo devolvía ids
(`leadId`, `interesId`, `biciId`), así que ManyChat no tenía con qué pintar el mensaje de valor.

Campos nuevos en la respuesta (mismo criterio plano que `mc-match` §2.1):

| Campo | Ejemplo | Para qué |
|---|---|---|
| `biciModelo` `biciTalla` `biciAnio` | `Levo SL S-Works` · `M` | encabezado |
| `biciPuntaje` | `6,4` | «Certificación: 6,4/7» |
| `biciAreaBaja` `biciAreaBajaLinea` | `Suspensión` · `Suspensión 5,9` | «dónde perdió puntos» (se calcula solo desde `Desglose puntaje`) |
| `biciEstadoHonesto` | *(párrafo crudo)* | el diferenciador |
| `biciPrecio` `biciPrecioNuevo` `biciAhorro` | `$3.500.000` · `$7.200.000` · `$3.700.000` | ancla de precio en pesos |
| `biciRangoAltura` | `1,65 – 1,78 m` | veredicto de talla |
| `biciBateria` `biciCiclos` `biciKmMotor` | `91` · `214` · `2840` | **solo e-bikes** (en musculares vienen vacíos) |
| `biciFoto` `biciFicha` | url | imagen y link de la ficha |
| `biciEstado` `biciDisponible` | `Disponible` · `true` | **bifurcar si la bici ya se vendió** — el reel sigue circulando |

Probado offline contra 4 casos reales (e-bike, muscular, vendida, ficha incompleta): 12/12 aserciones OK.
`mc-llamado` **no necesita cambios**: ya acepta `reel` para resolver la bici, y `ciudad`/`franja` son opcionales.

## 2 · Airtable — ✅ HECHO (2026-07-27)

9 campos nuevos en **`Llamados`** (`tblgApNKo9YiqPalw`):

**El brief que Luis ve antes de marcar** (lookups automáticos vía `Bici de interés`, no hay que llenarlos):
`Puntaje` · `Rango altura bici` · `Precio bici` · `Estado bici`

**Lo que Luis registra al colgar:**
- **`Salida`** — Visita agendada · Coordinación región · Encargo de búsqueda · Solo información · Sin interés
- **`Permiso WhatsApp`** (checkbox) — ⚠️ **sin esto marcado NO se le escribe**. El teléfono se pidió para una llamada, no para mensajes: este checkbox es el consentimiento limpio, obtenido por una persona y con fecha.
- `Próximo paso` (fecha) — un ticket sin próximo paso con fecha no está cerrado
- `Intentos` (número)

**La métrica de Roberto:** `Espera (min)` — minutos exactos entre que entró el ticket y la primera llamada. No usa `NOW()` (que en Airtable viene cacheado); se calcula con `Creado` y `Fecha primera llamada`, que ya existían y los sella una automatización.

## 3 · Lo que falta para el miércoles

### 3.1 Manual en Airtable (interfaz — no hay API) 🧑
**Pantalla de Luis**, sobre la tabla `Llamados`, filtrada por `Estado = Llamada pendiente`, ordenada por `Creado` ascendente:
- Arriba, solo lectura: `Nombre` · `Teléfono` · `Puntaje` · `Rango altura bici` · `Precio bici` · `Estado bici` · `Notas`
- Abajo, editable: `Salida` · `Permiso WhatsApp` · `Próximo paso` · `Notas` · `Estado`
- Al compartir con Luis: permiso **Editar** (si no, no puede registrar nada).

**Automatización nueva:** cuando una `Solicitudes` pasa a `Buscando` → aviso a Roberto y Alfonso (pedido de Roberto: hoy el sourcing no tiene trazabilidad).

### 3.2 ManyChat 🧑
- Rehacer las 6 automatizaciones de comentario con el flujo nuevo (bloques en `embudo_v2_diseno.html`).
- **10 palabras clave por reel** (decisión: NO any-word). Elegirlas así: la palabra del caption + variantes de precio (`precio`, `valor`, `cuánto`, `$$$`, `$$`) + typos frecuentes del modelo.
- ⚠️ En `mc-llamado` **NO mandar `optin:true`**: el permiso de WhatsApp lo marca Luis en la llamada. Mandarlo desde el bot es consentimiento de canal A usado en canal B.
- Mantener el botón de flujo en la respuesta privada (es terminal: sin botón, el hilo muere).

### 3.3 Verificación bloqueante ⚠️
**Confirmar que la plantilla `nuevo_llamado` está aprobada por Meta.** Quedó en revisión el 2026-07-09 y nunca se confirmó. **Si no está aprobada, Luis no se entera de que entró un lead y el embudo muere en el ticket.** Plan B mientras tanto: la página 📞 Llamados + el briefing de las 9:00 abriendo con la cola de pendientes.

## 4 · Puerta de DM — lista para deployar, esperando a Roberto

El diseño está cerrado (reconocimiento de intención, sin menú). Lo único que falta son **los textos**, que dependen de los 6 documentos de Roberto:

| Ruta de intención | Qué necesita | Estado |
|---|---|---|
| Modelo específico | *(nada — usa `mc-match`, ya corregido con bigramas)* | ✅ lista |
| Asesoría / quiz | *(nada — usa `mc-match` modo B)* | ✅ lista |
| Vender su bici | *(nada — usa `mc-consigna`)* | ✅ lista |
| **Envíos a regiones** | texto de cobertura, plazos y costo | 🔧 Roberto |
| **Garantía** | documento de garantía real (hoy la web promete «1 año extendible a 2» sin detalle) | 🔧 Roberto |
| **Pagos / cuotas** | medios de pago, cuotas, si reciben la bici en parte de pago | 🔧 Roberto |
| **Recompra** | condiciones (es el diferenciador tipo TPC/Kavak que Roberto quiere) | 🔧 Roberto |

Todas las rutas informativas cierran igual: **ofreciendo la llamada**. Apenas lleguen los textos, es pegar copy en bloques ya montados.

## 5 · Cómo se sabe si funcionó

| # | Métrica | Hoy | Meta |
|---|---|---|---|
| 1 | **% de leads que entregan teléfono** | 3 % | **20–30 %** |
| 2 | Espera hasta la primera llamada (mediana) | 109 min | < 30 min |
| 3 | % de tickets nunca llamados | no se medía | 0 % |
| 4 | Visitas agendadas por llamada | — | *métrica de Luis, no del bot* |

⚠️ **No evaluar el rediseño por la métrica 4 a las dos semanas.** Con ~31 leads/semana no hay señal estadística; la métrica que dice si el bot mejoró es la 1. Comparar siempre contra la semana 30.
