# El sistema de avisos al equipo — as-built

> Reescrito el **2026-08-19** a partir de la auditoría que disparó Gabriel:
> *«¿por qué le está llegando este mensaje a Luis, si esas personas ya fueron
> contactadas y están marcadas como sin interés?»*.
>
> Este documento es la fuente de verdad operativa. El histórico está en el
> [`CHANGELOG.md`](../CHANGELOG.md).

---

## 1 · La idea en una frase

**«Avisado» no es un evento: es un estado escrito en Airtable.**

Cada cosa que necesita a una persona nace con el campo **`Aviso equipo enviado`
vacío**. Ese vacío *es* la cola. Tres mecanismos la vacían:

| Cuándo | Qué |
|---|---|
| Al instante, si alguien está en su turno | el emisor (`aviso-llamada`, `aviso-humano`, …) manda y sella |
| Cada 15 min | `cron-avisos` barre lo que quedó sin sello y lo manda |
| 9:00 de la mañana | `cron-briefing` lista **todo** lo pendiente y lo sella |

**La regla que lo hace seguro: nunca franja sin red.** Ningún punto del sistema
puede callarse por horario si no existe algo que recupere después lo que calló.

---

## 2 · Las dos entradas comunes

Antes cada puerta del embudo tenía su propio camino para avisar. Ahora hay **dos
entradas, una por tipo de necesidad**, y da igual por qué canal entró la persona.

### 📞 `POST /api/aviso-llamada` — «alguien dejó su teléfono»

Alias histórico: `/api/mc-llamado` (los flujos de ManyChat ya montados siguen
funcionando sin tocarlos).

```json
{
  "handle": "nspringm2020",          // Instagram, sin arroba
  "subscriber_id": "1979973583",     // ManyChat — el único id estable en WhatsApp
  "telefono": "+56942327952",        // el número a llamar (y respaldo de identidad)
  "canal": "WhatsApp",               // DM IG · Comentario IG · WhatsApp · Web · Quiz
  "mensaje": "¿el precio es conversable?",
  "ciudad": "Puerto Varas",
  "dia": "mañana",                   // hoy · mañana · lunes… · YYYY-MM-DD
  "franja": "Tarde",
  "bici": "recXXX",                  // o "reel": "DbCLcpEB4aT", o "ref": "4082552"
  "notas": ""
}
```

**Basta UNO de los tres identificadores.** Antes exigía `handle` o
`subscriber_id`, así que un formulario de la web —que sólo tiene teléfono— no
podía entrar.

Qué hace: resuelve o crea el Lead → sella `Fecha teléfono` (la métrica #1) →
crea el ticket en `Llamados` ya en su columna del Kanban → **deduplica** contra
el ticket abierto del mismo lead → avisa al equipo **con contexto** → sella.

Devuelve `promesaLlamada` («en los próximos minutos» / «mañana a partir de las
10:00») para que el bot nunca prometa una llamada que el horario no permite.

### 🆘 `POST /api/aviso-humano` — «el bot no pudo, esto necesita a una persona»

Alias histórico: `/api/mc-aviso`. Lo llaman AB-2 (anti-bucle), T-2 (pregunta
técnica por chat) y, desde ahora, también el backend (`mc-rellamar` cuando
alguien aprieta un botón sobre un ticket que ya avanzó).

```json
{
  "subscriber_id": "99887766",
  "canal": "WhatsApp",
  "motivo": "el bot no entendió el mensaje",
  "mensaje": "tienen algo para mi hijo de 12"
}
```

Registra en la tabla `Avisos` y avisa. **El registro ocurre siempre**, aunque el
WhatsApp no salga: la métrica de «cuántas veces el bot necesitó a un humano» no
puede depender de que el mensaje se haya entregado.

---

## 3 · El contexto que viaja con el aviso

> *«Sería ideal agregar contexto a ese mensaje para que quien llame supiera más
> de la conversación que el bot tuvo con la persona, qué bicicleta vio o cuáles
> han sido sus consultas.»*

Lo arma `contextoLead()` en `lib/avisos.js`, **desde el CRM** — no desde
ManyChat: lo que el bot hizo ya está escrito en Airtable.

```
📞 LLAMAR · Nicolás Springmuller · +56942327952 · por WhatsApp · de Puerto Varas
 · pregunta por Kenevo Expert · vio: Kenevo Expert (match 02/08), Levo SL (ficha 27/07)
 · 2 tickets de llamada · 2º aviso · estado match_entregado
 · dijo: «¿el precio es conversable?»
```

Los segmentos van **del más accionable al menos**, porque el texto se corta por
el final si excede el tope de la plantilla: lo que se pierde al truncar es lo
prescindible.

---

## 4 · Horario por persona — la tabla `Equipo`

Hasta ahora había **una franja 9–20 pareja para todos**. Ahora cada persona
declara su turno y qué tipos de aviso recibe.

| Campo | Qué |
|---|---|
| `Nombre` | quién es |
| `SID ManyChat` | su id de suscriptor. Sin esto no se le puede mandar nada |
| `Horario` | `días@desde-hasta`, hora de Chile, separados por `\|`. **Vacío = la franja general** |
| `Recibe` | Llamadas · Humano · Solicitudes · Consignaciones · Sourcing · Reagendo · Briefing |
| `Activo` | apagado = la fila no existe para el sistema |
| **`Atiende clientes`** | **quién le CONTESTA a la persona.** De esta gente sale la promesa que el bot le hace al cliente — ver §4-bis |

### El turno real del equipo (Gabriel, 2026-08-20)

| Quién | Horario | Recibe | Atiende | SID |
|---|---|---|---|---|
| **Luis** | `1,3-5@9-20\|6@9-15` — lun, mié a vie 9–20 · sáb 9–15 | todo | ✅ | `579628082` |
| **Juan Alfonso** | `2@9-20` — cubre el martes | todo | ✅ | ⚠️ **falta** |
| **Roberto** | `*@8-20` — todos los días | todo + Sourcing | ❌ | `302195575` |
| **Gabriel** | `*@8-20` — todos los días | todo + Sourcing | ❌ | ⚠️ **falta** |

**Nadie atiende los domingos**, y el martes lo cubre sólo Juan Alfonso. Mientras
falte su SID, el martes el aviso le llega únicamente a Roberto — pero la promesa
al cliente **sí** cuenta el martes, porque Juan Alfonso trabaja aunque todavía no
esté cableado en ManyChat.

## 4-bis · Quién atiende ≠ quién recibe el aviso

Parecen lo mismo y no lo son, y confundirlos hace que el bot mienta.

Gabriel y Roberto reciben avisos **todos los días de 8 a 20** para mirar el
negocio. El que le contesta a la persona es **Luis** (y **Juan Alfonso** los
martes). Si la promesa saliera de «quién recibe el aviso», un domingo a las 10:00
el bot prometería respuesta ese mismo día porque Roberto está de turno.

Por eso el checkbox **`Atiende clientes`**: sólo esas filas entran en el cálculo
de la promesa. Y a propósito **no se exige `SID ManyChat`** para contar: el
horario que se le promete al cliente depende de quién **trabaja**, no de quién
está registrado para recibir WhatsApp.

### Lo que el bot le dice a la persona

`promesaAtencion()` en `lib/avisos.js` — una sola función para los dos usos, que
sólo cambian el texto de «hay alguien ahora»:

| Cuándo escribe | Llamada (`aviso-llamada`) | Respuesta por chat (`aviso-humano`) |
|---|---|---|
| lunes 11:00 | «en los próximos minutos» | «en un rato» |
| lunes 07:00 | «hoy a partir de las 9:00» | ídem |
| **domingo 03:00** | **«mañana lunes a partir de las 9:00»** | ídem |
| lunes 21:00 | «mañana martes a partir de las 9:00» | ídem |
| sábado 16:00 | «el lunes a partir de las 9:00» | ídem |

La promesa **nombra el día** cuando no es hoy. Pedido de Gabriel: *«si alguien
escribe un domingo a las 3 AM, se le dice: ok, perfecto, nuestro especialista te
responderá mañana (lunes) apenas llegue»*.

⚠️ **`aviso-humano` devuelve `promesa` en su respuesta, pero ManyChat todavía no
la imprime.** Hay que mapear `$.promesa` a un campo del contacto y usarlo en el
copy de AB-3 y T-2, que hoy dicen «Espérame un poco 🙌» sin plazo. Es trabajo
manual en ManyChat.

**Formato del horario.** Días `0`=domingo … `6`=sábado, con rangos y comas.
`hasta` es **exclusivo** (a las 20:00 en punto ya es fuera).

```
1-5@9-20|6@10-15     lunes a viernes 9 a 20, sábado 10 a 15
*@8-22               todos los días
1,3,5@10-18          lunes, miércoles y viernes
```

### La red de seguridad, y por qué importa

El 2026-08-06 se **borró** la lógica por persona justamente porque vivía copiada
seis veces en dos dialectos incompatibles. Volver a tenerla sólo es seguro con
tres condiciones, y las tres se cumplen:

1. **Vive en un solo archivo** (`lib/avisos.js`). Ningún endpoint decide horarios.
2. **Sin la tabla, o con todos inactivos, el sistema se comporta EXACTAMENTE como
   antes**: envs `AVISO_*_SIDS` + franja global. Probado en `test/equipo-horarios.mjs`.
3. **El fallback es por tipo**: si nadie está suscrito a `Briefing` en la tabla,
   ese aviso cae a `BRIEFING_SIDS` aunque otros tipos sí tengan gente.

### Dos excepciones que ignoran el horario, a propósito

| Tipo | Por qué |
|---|---|
| `Briefing` | tiene su propia hora (9:00). Filtrarlo por turno lo apagaría |
| `Reagendo` | avisa que una visita de **hoy** se movió, y es el único aviso que **no deja sello**: sin red, silenciarlo es perderlo |

Y un escape: `AVISO_HUMANO_24H=1` devuelve los avisos de «humano requerido» al
comportamiento anterior (sonar siempre, sin mirar el turno).

### La promesa al cliente sale del mismo lugar

`promesaLlamada` se calcula con la **unión de los turnos de quien recibe
Llamadas**. «Cuándo te llamamos» debe ser «cuándo hay alguien a quien le llega el
aviso»; mantener dos horarios separados es la enfermedad que produjo las seis
copias. La env `HORARIO_ESPECIALISTA`, si está seteada, sigue mandando (escape
manual).

---

## 5 · El briefing de la mañana

Sale a las **9:00** de Chile, todos los días, a quien esté suscrito a `Briefing`.

Ahora lista **cinco secciones**, y el título de cada una **es la acción pendiente**:

```
📞 POR LLAMAR · 3: (1) Ana · +56911 · WhatsApp · 🆕 nadie lo ha visto  …
🆘 SIN RESPONDER · 2: (1) @paljaro · DM IG · «Quiero una de entrada…» · esperando 1d  …
🔎 POR BUSCAR · 1: (1) Epic 8 talla M · hasta $3.500.000 · +56922 · esperando 2d
🚲 POR EVALUAR · 1: (1) Tarmac SL7 · pide $3.500.000 · +56933 · esperando 1d
📅 VISITAS DE HOY · 2: (1) 11:00 · Juan · Levo SL · +56944  …
```

Antes sólo sabía de llamados y visitas. Las otras tres colas se acumulaban sin
que ningún briefing las nombrara: **si el bot no entendía un mensaje a las 23:00,
a la mañana siguiente no se enteraba nadie.**

Detalles que importan:

- **Lista TODA la cola, no sólo lo nuevo.** Si un aviso individual salió un día
  que nadie estaba mirando, el registro igual reaparece mañana. Los que nadie ha
  visto van primero y marcados `🆕`.
- **Sella las cuatro colas**, no sólo los llamados. Lo que entra al mensaje se
  sella; **lo que no cupo se deja sin sellar a propósito** para que el barrido de
  las 09:15 lo mande individualmente. Ni silencio ni duplicado.
- **Si el briefing no le llegó a nadie, no sella nada.** Degradación elegante:
  más mensajes, menos contexto, cero pérdida.
- **Presupuesto compartido en orden de urgencia.** Si la cola de llamadas está
  desbordada se come el espacio y las demás dicen honestamente cuántas quedaron
  fuera. Una llamada que se enfría cuesta más que una consignación que espera un día.
- **Ventana de 7 días** para «SIN RESPONDER» (`AVISOS_VENTANA_DIAS`). Sin esto,
  un aviso que nadie marcó `Resuelto` se quedaría para siempre y el equipo
  aprendería a ignorar la sección — que es como muere un tablero.

⚠️ **Interruptor de plantilla.** `briefing_diario` (v1) tiene UNA variable;
`briefing_diario_v2` tiene dos. `BRIEFING_V2=1` se setea **en el mismo momento**
en que `FLOW_NS_BRIEFING` pasa a apuntar a la v2. Con la v1 apuntada y dos
variables, el mensaje imprimiría sólo las visitas… y se sellaría igual.

---

## 5-bis · El Kanban «6 · Falta responder»

> Pedido de Gabriel (2026-08-20): *«una cola de todas las solicitudes que requieran
> la intervención de un humano, tipo kanban, y así podemos dejar registrado el hecho
> de que un humano haya respondido y marcar qué pasa con ese lead»*.

El hueco que tapa: una conversación que el bot no pudo resolver se registraba en
`Avisos`, alguien la respondía a mano… **y ahí se acababa el rastro**. Si esa
persona terminaba en la cola de llamados y quedaba sin interés, eso no quedaba
escrito en ninguna parte.

**Pantalla 6 de la interfaz «Operación Llamadas (V2)»** (`pag4VY9lp3n8LpZzr`),
Kanban sobre la tabla `Avisos` agrupado por **`Salida`**. Mismo principio que el
Kanban de Luis: **arrastrar la tarjeta ES registrar lo que pasó**, un solo gesto.

| Columna | Cuándo | Qué implica |
|---|---|---|
| **Pendiente** | nadie respondió todavía | sigue en el briefing bajo `🆘 FALTA RESPONDER` |
| **Respondido** | le contestaron y ahí quedó | sale de la cola |
| **Pasó a llamada** | entró a la cola de llamados | se enlaza el ticket en `Llamado` |
| **Sin interés** | habló y no va a avanzar | el motivo real va en `Notas` |
| **Spam / no aplica** | no era un lead | — |

Campos de la tarjeta: `@handle IG` · `Canal` · **`Mensaje`** (lo que escribió) ·
`Creado` · `Subscriber ID` (cómo encontrarlo en ManyChat cuando no hay handle) ·
`Atendido por` · `Notas` · `Llamado` · `Lead` · `Respuesta (min)`.

**`Respuesta (min)`** mide cuánto tardó un humano en atender, y **no necesita
ninguna automatización**: cuelga de `LAST_MODIFIED_TIME({Salida})`. El precio es
que si se re-arrastra la tarjeta el número se recalcula — aceptable para lo que
mide. (La alternativa sería otra automatización de Airtable, y ya hay una
esperando publicación.)

Ordenado por antigüedad: **arriba el que lleva más esperando**.

## 6 · 🔴 La cola se define por `Salida`, nunca por `Estado`

**Éste es el bug que disparó la auditoría, y la lección que deja.**

`Llamados` tiene dos campos que parecen decir lo mismo:

| Campo | Quién lo escribe | Qué es |
|---|---|---|
| **`Salida`** | **Luis**, arrastrando la tarjeta del Kanban | la verdad operativa |
| `Estado` | el código (`salida-llamado`) | un espejo, para las vistas y automatizaciones viejas |

El briefing armaba su cola con `{Estado}='Llamada pendiente'`. Pero el espejo
tenía **dos caminos por los que no se escribía**, porque se sincronizaba al final
de la función y estos dos se iban antes:

- `sin_lead` → tickets sin Lead enlazado (los que el staff crea con el «+»);
- `ya_enviado` → tickets que ya mandaron un mensaje al cliente.

Resultado medido en producción: `recCkAybRN6Udjb7c` (Rodrigo Riquelme) quedó con
`Salida = Sin interés` y `Estado = Llamada pendiente`, y el briefing se lo
repitió a Luis **trece mañanas seguidas**.

La corrección tiene dos mitades y las dos son necesarias:

1. `salida-llamado` sincroniza el espejo **antes de cualquier return temprano**.
2. Briefing, barrido y dedup leen la cola por **`Salida`**. Aunque el espejo se
   vuelva a romper, la cola no miente.

Las dos colas con Kanban están declaradas **una sola vez**, en `lib/avisos.js`, y
las importan el briefing, el barrido y el dedup:

```js
export const COLA_LLAMADOS =
  `OR({Salida}='Llamada pendiente', {Salida}='No contestado', {Salida}=BLANK())`;

export const COLA_AVISOS =
  `AND({Resuelto}=0, OR({Salida}=BLANK(), {Salida}='Pendiente'))`;
```

`No contestado` sigue en la cola a propósito: no contestar no cierra nada, es la
bandeja de reintentos. `BLANK()` cubre el ticket recién creado. `Resuelto` se
conserva como escape manual: sólo puede **sacar** cosas de la cola, nunca
meterlas, así que no puede producir fantasmas.

> **La lección general: la cola la define el campo del OPERADOR, no el derivado.**
> Guardas en `test/guardas-avisos.mjs` (§7 y §8) para que no vuelva.

---

## 7 · Mapa de piezas

| Archivo | Qué hace |
|---|---|
| `lib/avisos.js` | **Único dueño** del horario, los destinatarios, el contexto y el envío |
| `functions/api/aviso-llamada.js` | Entrada común «dejó su teléfono» (alias: `mc-llamado`) |
| `functions/api/aviso-humano.js` | Entrada común «necesita a una persona» (alias: `mc-aviso`) |
| `functions/api/cron-avisos.js` | Barrido cada 15 min sobre las **cuatro** colas |
| `functions/api/cron-briefing.js` | El briefing de las 9:00 |
| `functions/api/salida-llamado.js` | Post-llamada: espejo del Estado, mensaje al cliente, encargo |
| `functions/api/mc-rellamar.js` | El botón «Sí, llámenme» |
| `mc-waitlist` · `mc-consigna` · `cron-sourcing` · `mc-agenda` | Emisores de sus propias colas, todos vía `avisar()` |

### Las siete familias de aviso

| Tipo | Cola / disparo | Plantilla | `Recibe` |
|---|---|---|---|
| `llamada` | `Llamados` sin sello | `nuevo_llamado` | Llamadas |
| `humano` | `Avisos` sin resolver | `aviso_equipo` | Humano |
| `solicitud` | `Solicitudes` `Llamada pendiente` | `solicitud_busqueda_v2` | Solicitudes |
| `consigna` | `Consignaciones` `Nueva` | `nueva_consignacion` | Consignaciones |
| `sourcing` | `Solicitudes` → `Buscando` | `FLOW_NS_BUSCANDO` | Sourcing |
| `reagendo` | visita de hoy movida | `visita_reagendada` | Reagendo |
| `briefing` | 9:00 | `briefing_diario_v2` | Briefing |

---

## 8 · Qué falta (y no es código)

| # | Qué | Dónde | Mientras falte |
|---|---|---|---|
| 1 | **Publicar el borrador** de la automatización «Sello de 1ª llamada · Llamados» | Airtable | 🔴 El arreglo del 2026-08-07 **nunca se publicó**: lo que corre en vivo sigue colgando de `Estado`, así que **`Espera (min)` sigue vacío para todo ticket «No contestado»** |
| 2 | Llenar y **activar** las filas de la tabla `Equipo` | Airtable | El sistema usa la franja 9–20 pareja de siempre |
| 3 | Plantilla `aviso_equipo` aprobada + `FLOW_NS_AVISO_EQUIPO` | Meta / Cloudflare | Los avisos de «humano requerido» se registran pero no salen por WhatsApp |
| 4 | `briefing_diario_v2` + `BRIEFING_V2=1` | Meta / Cloudflare | El briefing va en una sola variable, apelmazado |
| 5 | Apuntar los flujos nuevos a `/api/aviso-llamada` y `/api/aviso-humano` | ManyChat | Nada: los alias funcionan indefinidamente |
