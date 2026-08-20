# El sistema de avisos de Bike Trust

> **Qué es esto.** El documento único del sistema que le avisa al equipo cuando algo
> necesita a una persona. Sirve para dos lectores a la vez:
>
> - **Si eres del equipo:** lee de la §1 a la §7. Están en castellano normal y
>   explican qué hace el sistema, qué significa cada aviso y qué tienes que hacer tú.
> - **Si eres Claude Code (o cualquiera que vaya a tocar el código):** la §8 es la
>   sección técnica. **Léela entera antes de modificar nada**, sobre todo §8.6, que
>   son las reglas que ya se rompieron una vez y costaron caro.
>
> Estado: **en producción** desde el 2026-08-20. Historial y porqués en
> [`CHANGELOG.md`](../CHANGELOG.md).

---

## 1 · Para qué existe

Bike Trust vende bicicletas usadas caras. El negocio se cierra por teléfono: alguien
comenta un reel, el bot le muestra la ficha, y si deja su número, **Luis lo llama**.
La velocidad de esa llamada es la métrica del negocio.

Todo el sistema de avisos existe para responder una sola pregunta:

> **¿Hay alguien esperando que nadie del equipo ha visto todavía?**

Y para garantizar que la respuesta nunca sea «sí, pero no nos dimos cuenta».

## 2 · La idea en una frase

**«Avisado» no es un evento: es un estado escrito en Airtable.**

Cada cosa que necesita a una persona nace con el campo **`Aviso equipo enviado`
vacío**. Ese vacío *es* la cola. Tres mecanismos la vacían:

| Cuándo | Qué pasa |
|---|---|
| Al instante, si hay alguien de turno que va a actuar | sale el WhatsApp y se sella |
| Cada 15 minutos | un barrido manda lo que quedó sin sello |
| 9:00 de la mañana | el briefing lista **todo** lo pendiente y lo sella |

**La regla que lo sostiene: nunca franja sin red.** Ningún punto del sistema puede
callarse por horario si no existe algo que recupere después lo que calló.

Esto no es una preferencia de diseño: es la corrección de un problema real. Antes,
«avisarle al equipo» ocurría —o no— en el instante exacto en que entraba el lead. Si
en ese momento no era horario, si fallaba una conexión, o si el ticket lo había
creado una persona a mano, el aviso se perdía **para siempre y sin dejar rastro**.
Medido en su momento: de 5 tickets vivos, 4 nunca dispararon un aviso, y hubo que
rescatar 4 leads a mano después de diez días varados.

## 3 · Las dos puertas de entrada

Da igual por dónde llegue la persona —comentario de Instagram, DM, WhatsApp, la web—
y da igual si mañana se agrega otro canal. Sólo hay **dos** entradas, una por tipo de
necesidad:

### 📞 «Alguien dejó su teléfono»

Alguien entregó su número. Se le crea un ticket en la tabla `Llamados`, aparece en el
Kanban de Luis, y sale el aviso con **el número y el contexto**.

### 🆘 «Esto necesita a una persona»

El bot no pudo resolverlo: no entendió el mensaje, o alguien pidió que le respondan
por chat. Queda registrado en la tabla `Avisos` y sale el aviso.

> **Lo importante:** cualquiera de las dos acepta el `@handle` de Instagram, el id de
> ManyChat **o el teléfono**. Antes exigían el handle de Instagram, así que un lead
> que llegaba por WhatsApp o desde la web se caía o nacía huérfano — sin ficha
> enlazada y fuera de las métricas.

## 4 · El contexto viaja con el aviso

Un aviso que sólo dice «llama a este número» obliga a Luis a reconstruir la
conversación antes de marcar. Así que el aviso lleva lo que el sistema ya sabe:

```
📞 LLAMAR · Nicolás Springmuller · +56942327952 · por WhatsApp · de Puerto Varas
 · pregunta por Kenevo Expert
 · vio: Kenevo Expert (match 02/08), Levo SL (ficha 27/07)
 · 2 tickets de llamada · 2º aviso · estado match_entregado
 · dijo: «¿el precio es conversable?»
```

Sale del CRM, no de ManyChat: lo que el bot hizo ya está escrito en Airtable.

Los datos van **del más accionable al menos**, porque si el texto excede el largo que
permite WhatsApp se corta por el final — y lo que se pierde tiene que ser lo
prescindible, nunca el teléfono.

## 5 · Quién recibe qué, y a qué hora

Todo esto se configura en la tabla **`Equipo`** de Airtable. **El sistema la lee en
cada aviso**, así que editarla cambia el comportamiento al instante, sin que nadie
tenga que desplegar código.

| Campo | Qué es |
|---|---|
| `Nombre` | quién es |
| `SID ManyChat` | su id de suscriptor. Sin esto no se le puede mandar nada |
| `Horario` | cuándo recibe avisos (formato abajo). **Vacío = de 9 a 20 todos los días** |
| `Recibe` | qué tipos de aviso le llegan |
| `Activo` | apagado = esta fila no existe para el sistema |
| `Atiende clientes` | **quién le CONTESTA a la persona.** Ver §5.3 — no es lo mismo que `Recibe` |

### 5.1 · El formato del horario

Bloques `días@desde-hasta`, separados por `|`. Días: `0`=domingo … `6`=sábado.
La hora de cierre es **exclusiva**: `9-20` significa que a las 20:00 en punto ya es
fuera.

```
1-5@9-20|6@9-15      lunes a viernes de 9 a 20, sábado de 9 a 15
*@8-20               todos los días de 8 a 20
1,3-5@9-20           lunes, y de miércoles a viernes
```

### 5.2 · El turno real hoy

| Quién | Horario | Recibe | Atiende |
|---|---|---|---|
| **Luis** | `1,3-5@9-20` + `6@9-15` — lun, mié a vie 9–20 · sáb 9–15 | todo | ✅ |
| **Juan Alfonso** | `2@9-20` — cubre el martes | todo | ✅ |
| **Roberto** | `*@8-20` — todos los días | todo | ❌ |
| **Gabriel** | `*@8-20` — todos los días | todo | ❌ |

**Nadie atiende los domingos.** El martes lo cubre sólo Juan Alfonso.

### 5.3 · 🔴 Recibir no es lo mismo que atender

Ésta es la distinción más importante de toda la configuración, y confundirla tiene
dos consecuencias caras.

**Gabriel y Roberto reciben los avisos todos los días de 8 a 20 para mirar el
negocio, pero no llaman a nadie.** De ahí salen dos reglas:

**(a) La promesa que el bot le hace al cliente sale de quien ATIENDE.**
Si saliera de quien recibe, un domingo a las 10:00 el bot prometería respuesta ese
mismo día porque Roberto está de turno. Sería mentira.

**(b) Recibir un aviso no lo saca de la cola.**
El sello significa «este caso está cubierto». Si lo escribiera cualquiera que recibe,
un lead que entra un domingo quedaría sellado por la recepción de Gabriel y Roberto,
y el lunes le aparecería a Luis marcado *«esperando 20h»* y **ordenado después de los
que nadie vio**. Los leads más frescos quedarían sepultados bajo los más viejos.

Por eso: **el sello exige que se entere alguien con `Atiende clientes`.** El
observador recibe su WhatsApp igual —lo pidió— pero la cola no se descuenta.

> ⚠️ Esta regla aplica sólo a los avisos de cara al cliente (llamadas y «necesita una
> persona»). En consignaciones, búsquedas y sourcing el que actúa es Roberto:
> exigirle ahí el flag dejaría esas colas sin sellar nunca.

## 6 · El briefing de la mañana

Sale a las **9:00** de Chile, todos los días, a quien **trabaja ese día**.

```
📞 POR LLAMAR · 3: (1) Ana · +56911 · WhatsApp · 🆕 nadie lo ha visto  …
🆘 FALTA RESPONDER · 2: (1) @paljaro · DM IG · «Quiero una de entrada…» · esperando 1d
🔎 POR BUSCAR · 1: (1) Epic 8 talla M · hasta $3.500.000 · +56922 · esperando 2d
🚲 POR EVALUAR · 1: (1) Tarmac SL7 · pide $3.500.000 · +56933 · esperando 1d
📅 VISITAS DE HOY · 2: (1) 11:00 · Juan · Levo SL · +56944  …
```

**El título de cada sección es la acción pendiente.** Nadie tiene que deducir qué
hacer con cada línea.

Detalles que importan:

- **Lista toda la cola, no sólo lo nuevo.** Si un aviso salió un día que nadie estaba
  mirando, el caso reaparece mañana. Los que nadie ha visto van primero y marcados 🆕.
- **Mira el día, no la hora.** Quien entra a las 10:00 igual recibe el de las 9:00;
  quien cubre sólo los martes no recibe seis resúmenes inútiles por semana.
- **Lo que entra al mensaje se sella; lo que no cupo, no.** Así el barrido de las
  09:15 manda individualmente lo que quedó fuera. Ni silencio ni duplicado.
- **Si el briefing no le llegó a nadie, no sella nada.** Más mensajes, menos
  contexto, cero pérdida.
- **Ventana de 7 días** para «FALTA RESPONDER». Sin eso, un aviso que nadie marcó
  resuelto se quedaría para siempre y el equipo aprendería a ignorar la sección — que
  es como muere un tablero.
- **Si una tabla no se puede leer, lo dice** («⚠️ NO SE PUDO LEER Solicitudes»). Un
  briefing que dice «nada pendiente» porque falló una lectura es peor que no mandarlo.

## 7 · Los dos tableros, y qué hacer en cada uno

### 📞 «1 · Llamadas» — el Kanban de Luis

Todo lead que entrega su teléfono cae acá. **Arrastrar la tarjeta ES marcar la salida
ES disparar el mensaje al cliente.** No hay un segundo paso que se pueda olvidar.

| Columna | Cuándo | Qué dispara |
|---|---|---|
| 📞 Llamada pendiente | la crea el bot | — |
| 🏬 Visita agendada | vive en Santiago y viene | confirmación + recordatorios |
| 📍 Coordinación región | fuera de Santiago | mensaje de gestión |
| 🔎 Encargo de búsqueda | no tenemos lo que busca | crea el ticket de búsqueda |
| ↩️ No contestado | no se pudo hablar | mensaje de rescate · **vuelve a la cola** |
| ✖️ Sin interés | habló y no avanza | nada. El motivo va en `Notas` |

### 🆘 «6 · Falta responder» — las conversaciones que el bot no pudo

Mismo principio: arrastrar **es** registrar qué pasó con ese lead.

| Columna | Qué implica |
|---|---|
| Pendiente | sigue apareciendo en el briefing |
| Respondido | le contestaron y ahí quedó |
| Pasó a llamada | se enlaza el ticket que nació |
| Sin interés | el motivo real va en `Notas` |
| Spam / no aplica | no era un lead |

### 7.1 · Si algo se ve raro

| Síntoma | Qué mirar |
|---|---|
| «Me llegó un aviso de alguien que ya atendí» | ¿la tarjeta quedó en la columna correcta del Kanban? La cola se lee por ahí |
| «No me está llegando nada» | tu fila en `Equipo`: ¿`Activo` marcado? ¿`SID ManyChat` cargado? ¿el tipo en `Recibe`? |
| «Me llegan avisos a deshora» | tu `Horario` en `Equipo`. Ojo: la hora de cierre es exclusiva |
| «El briefing dice que no hay nada y sí hay» | busca «NO SE PUDO LEER» en el mensaje: es un fallo de lectura, no una cola vacía |
| «Un lead que dejó su teléfono no aparece» | ¿lo capturó una persona a mano en ManyChat? Ese camino todavía no escribe en el CRM (§9) |

---

# 8 · Sección técnica

> Para Claude Code y para quien vaya a tocar el código. Todo lo de abajo está vivo en
> `biketrust-sitio` (Cloudflare Pages). Los tests se corren con `npm test`.

## 8.1 · Mapa de archivos

| Archivo | Rol |
|---|---|
| **`lib/avisos.js`** | **El único dueño** del horario, los destinatarios, el contexto y el envío. Vive fuera de `functions/` para que Pages no lo rutee |
| `functions/api/aviso-llamada.js` | Entrada común «dejó su teléfono». Alias: `mc-llamado.js` |
| `functions/api/aviso-humano.js` | Entrada común «necesita una persona». Alias: `mc-aviso.js`. Exporta `avisarHumano()` para los avisos que nacen en el backend |
| `functions/api/cron-avisos.js` | Barrido cada 15 min sobre las **cuatro** colas |
| `functions/api/cron-briefing.js` | El briefing de las 9:00 |
| `functions/api/salida-llamado.js` | Post-llamada: espejo del `Estado`, mensaje al cliente, creación del encargo |
| `functions/api/mc-rellamar.js` | El botón «Sí, llámenme» |
| `mc-waitlist` · `mc-consigna` · `cron-sourcing` · `mc-agenda` | Emisores de sus propias colas, todos vía `avisar()` |

El disparador de los cron es `worker-cron/src/index.js`, un Worker aparte: Pages
Functions no soporta cron nativo.

## 8.2 · Las siete familias de aviso

| `tipo` | Cola | Plantilla | `Recibe` |
|---|---|---|---|
| `llamada` | `Llamados` sin sello | `nuevo_llamado` | Llamadas |
| `humano` | `Avisos` sin resolver | `aviso_equipo` | Humano |
| `solicitud` | `Solicitudes` `Llamada pendiente` | `solicitud_busqueda_v2` | Solicitudes |
| `consigna` | `Consignaciones` `Nueva` | `nueva_consignacion` | Consignaciones |
| `sourcing` | `Solicitudes` → `Buscando` | `FLOW_NS_BUSCANDO` | Sourcing |
| `reagendo` | visita de hoy movida | `visita_reagendada` | Reagendo |
| `briefing` | 9:00 | `briefing_diario_v2` | Briefing |

## 8.3 · La API de `lib/avisos.js`

```js
// Envío único. Decide destinatarios por turno y manda.
await avisar(env, { tipo, flowEnv, campo, texto, extra?, now?, ignorarHorario? })
// → { enviados, enviadosA, puedeSellar, motivo, errores, destinatarios }
```

**Cómo leer el resultado — esto es el contrato, no un detalle:**

| Resultado | Significa | Qué hacer |
|---|---|---|
| `puedeSellar: true` | se enteró alguien que va a actuar | **sellar** |
| `enviados > 0` pero `puedeSellar: false` | sólo lo vieron observadores | **no sellar** · motivo `solo_observadores` |
| `enviados: 0`, motivo `fuera_de_horario` | no hay nadie de turno | **no sellar**, no gastar intento |
| `enviados: 0`, otro motivo | fallo o falta configuración | **no sellar**, gastar intento |

`quedaPendiente(motivo)` agrupa los dos motivos que significan «sigue abierto, hay que
reintentar» y no son fallos: `fuera_de_horario` y `solo_observadores`.

Otras funciones: `destinatarios()` · `atiendenClientes()` · `hayQuienActue()` ·
`contextoLead()` · `promesaAtencion()` · `trabajaHoy()` · `enHorarioPersona()` ·
`horarioUnion()` · `cargarEquipo()` (caché de 60 s) · `unaLinea()`.

## 8.4 · Las colas, definidas una sola vez

```js
export const COLA_LLAMADOS =
  `OR({Salida}='Llamada pendiente', {Salida}='No contestado', {Salida}=BLANK())`;

export const COLA_AVISOS =
  `AND({Resuelto}=0, OR({Salida}=BLANK(), {Salida}='Pendiente'))`;
```

Las importan el briefing, el barrido y el dedup. **Ningún endpoint puede escribir la
suya** — hay guarda en `test/guardas-avisos.mjs`.

`No contestado` sigue en la cola a propósito: no contestar no cierra nada, es la
bandeja de reintentos. `Resuelto` es un escape manual que sólo puede **sacar** cosas
de la cola, nunca meterlas, así que no puede producir fantasmas.

## 8.5 · Constantes que gobiernan el comportamiento

| Constante | Valor | Dónde | Por qué |
|---|---|---|---|
| `AVISO_FRANJA` | `9-20` | env | Sólo se usa **sin** tabla `Equipo` |
| `MADUREZ_MIN` | 10 min | `cron-avisos` | No avisar la fila en blanco que alguien acaba de crear con el «+» |
| `MAX_POR_CORRIDA` | 10 | `cron-avisos` | Freno de ráfaga: 40 avisos/hora como techo |
| `MAX_INTENTOS` | 3 | `cron-avisos` | Un destinatario roto no puede reenviar para siempre |
| `REARME_MIN` | 120 min | `aviso-llamada`, `mc-rellamar` | Tres reels en una tarde = un aviso, no tres |
| `MAX_REAPERTURAS` | 3 | `mc-rellamar` | Después de 3 vueltas, insistir molesta |
| `MAX_VAR` | 880 | `cron-briefing` | Tope por variable de plantilla de WhatsApp |
| `VENTANA_DIAS` | 7 | `cron-briefing` | Higiene de la sección «FALTA RESPONDER» |
| `EQUIPO_TTL_MS` | 60 s | `lib/avisos.js` | Caché de la tabla `Equipo` |
| `BRIEFING_HOUR` | 9 | env | La ventana es `hora === N && minuto < 15` |

## 8.6 · 🔴 Las reglas que ya se rompieron una vez

**No las cambies sin leer por qué existen.** Cada una tiene guarda en
`test/guardas-avisos.mjs`.

**1 · La cola la define el campo del OPERADOR, no el derivado.**
`Llamados` tiene `Salida` (lo que arrastra Luis) y `Estado` (un espejo que mantiene el
código). El briefing leía `Estado`, el espejo se desincronizó por dos returns
tempranos, y un ticket cerrado se repitió a Luis **trece mañanas seguidas**. Todo
consumidor pregunta por el campo que toca la persona, y los espejos se escriben
**antes de cualquier return temprano**.

**2 · `ARRAYJOIN` de un campo de enlace devuelve el valor VISIBLE, no el record id.**
`FIND('recXXX', ARRAYJOIN({Lead}))` da **0 siempre**. Costó el botón «Sí, llámenme»
entero: nadie encontraba su ticket. Usa el **enlace inverso** (`Leads.Llamados`, que
sí trae ids) + `RECORD_ID()`. *Sí* vale `ARRAYJOIN` sobre un **lookup del RecID**.

**3 · El horario vive en un solo archivo.**
Llegó a haber **seis copias** de `horarioOk` en dos dialectos incompatibles, con
defaults que ya no coincidían. Si la env se hubiera seteado con el formato
documentado, tres de ellas habrían avisado 24/7 en silencio.

**4 · El `try` va DENTRO del bucle de destinatarios.**
Con el `try` afuera, un solo sid roto tumba el envío de todos los demás y —con el
barrido reintentando— produce una tormenta cada 15 minutos.

**5 · Recibir no es sellar.**
Ver §5.3. El sello exige `puedeSellar`, no `enviados > 0`.

**6 · Un mock permisivo esconde un bug de producción.**
Los 16 tests de `mc-rellamar` estaban verdes con el endpoint **muerto**, porque el
mock devolvía tickets a *cualquier* consulta. Cuando un test simula una API, que
**valide la consulta**, no sólo la ruta.

**7 · `NOW()` de Airtable viene cacheado.** Inútil para sellar horas. Usa
`LAST_MODIFIED_TIME({Campo})`.

**8 · Chile no es UTC-4 fijo.** Pasa a UTC-3 el primer sábado de septiembre. Todo
cálculo de fecha va por `Intl` con `America/Santiago`. Quedan ~11 líneas de deuda con
`Date.now() - 4*3600*1000` en el repo; el código nuevo no puede sumar más.

## 8.7 · Modelo de datos

**`Equipo`** (creada 2026-08-20) — `Nombre`, `SID ManyChat`, `Horario`, `Recibe`
(multi), `Activo`, `Atiende clientes`, `Notas`.
🔴 **Si la tabla está vacía, no existe, o nadie está `Activo`, el sistema vuelve al
comportamiento anterior**: envs `AVISO_*_SIDS` + franja `9-20` pareja. El fallback es
**por tipo**: si nadie está suscrito a `Briefing`, ese aviso cae a `BRIEFING_SIDS`
aunque otros tipos sí tengan gente.

**`Llamados`** — la cola central. `Salida` gobierna el Kanban;
`Aviso equipo enviado` es el sello del aviso **al equipo**; `Aviso salida enviado` es
el sello del mensaje **al cliente**. ⚠️ Son distintos y se confunden fácil.

**`Avisos`** — `Resumen`, `@handle IG`, `Subscriber ID`, `Canal`, `Motivo`, `Mensaje`,
`Salida` (Kanban), `Atendido por`, `Notas`, `Llamado` (link), `Respuesta (min)`,
`Aviso equipo enviado`, `Intentos aviso`, `Resuelto`, `Terminó en venta` (rollup).

`Respuesta (min)` mide la velocidad de atención humana **sin ninguna automatización**:
cuelga de `LAST_MODIFIED_TIME({Salida})`.

## 8.8 · Invariantes que los tests protegen

`npm test` — 16 suites, **344 aserciones**, 16 guardas. Las que más importan:

- El sello exige `puedeSellar`; un observador no descuenta la cola
- La cola se lee por `Salida`; el espejo se escribe antes de los returns tempranos
- Nadie busca por `ARRAYJOIN` de un campo de enlace
- Ningún endpoint define su propio horario ni lee `AVISO_*_SIDS` directo
- Ningún bucle de destinatarios queda envuelto por un `try` externo
- Sin tabla `Equipo`, el comportamiento es idéntico al anterior
- El briefing sella **exactamente** lo que entró al mensaje
- Domingo 3 AM → «mañana lunes a partir de las 9:00»

---

## 9 · Lo que falta

| # | Qué | Dónde | Mientras falte |
|---|---|---|---|
| 1 | **La recaptura del teléfono capturado a mano** | pendiente de decisión | Si una persona atiende el DM y le dan el número ahí, **no se escribe en el CRM**: sin ticket, sin `Fecha teléfono`, sin aviso. Pasó de verdad con un lead el 19-ago |
| 2 | `briefing_diario_v2` (2 variables) + `BRIEFING_V2=1` | Meta / Cloudflare | El briefing va apelmazado en un párrafo. ⚠️ Las dos cosas se hacen **en el mismo momento** |
| 3 | Las secciones que no caben desaparecen sin «(+N más)» | `cron-briefing` | Pega con más de ~11 llamados en cola |
| 4 | La caché de `Equipo` se envenena con un fallo transitorio | `lib/avisos.js` | Hasta 60 s sirviendo vacío tras un error de Airtable |
| 5 | Apuntar montajes nuevos a `/api/aviso-llamada` y `/api/aviso-humano` | ManyChat | Nada: los alias funcionan indefinidamente |

---

## 10 · Cómo se llegó hasta acá

El sistema se auditó dos veces con **agentes adversariales**: un grupo busca fallas
con lentes independientes, y otro grupo intenta **refutar cada hallazgo** antes de que
cuente como real.

| | Hallazgos | Confirmados | Descartados |
|---|---|---|---|
| Auditoría (2026-08-19, 12 agentes) | 47 | 42 | 5 |
| Revisión post-despliegue (2026-08-20, 8 agentes) | 25 | 4 | 21 |

Los escépticos cazaron **dos regresiones introducidas durante el propio arreglo** —
una consulta rota que yo mismo escribí, y la regla del sello que dejaba a los
observadores consumiendo la cola. Vale la pena mantener ese patrón cuando el cambio
es grande: la tasa de descarte alta (21 de 25 en la segunda pasada) es señal de que el
filtro está funcionando, no de que sobró trabajo.
