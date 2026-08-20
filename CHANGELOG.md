# Bike Trust · Historial del sistema

> **Para quien lee esto en frío (humano o Claude):** este archivo cuenta *qué pasó y por qué*,
> en orden. Si vienes llegando, léelo antes que cualquier otra cosa: explica por qué el
> sistema está como está y qué decisiones ya se tomaron (para no volver a discutirlas).
>
> El estado **actual** vive en [`CLAUDE.md`](CLAUDE.md). Este archivo es la memoria histórica.

---

## V2 · El embudo que apunta a la llamada — EN CONSTRUCCIÓN (desde 2026-07-27)

### 2026-08-20 (c) · DESPLEGADO. Y el briefing pasa a mirar el día, no la hora

**El sistema de avisos entró en producción** (`4b5e357`, con OK explícito de Gabriel). Verificado
en vivo: los cuatro endpoints responden y leen la tabla `Equipo`. El sábado del showroom pasó de
10–14 a **9–15** en `mc-agenda` y en los tres docs de copy operativo (⚠️ el texto vivo en ManyChat
se dejó como está por decisión suya: dice «hasta las 14:00», que es la última llegada útil, y el
validador acepta hasta esa hora por la regla de «1 h antes del cierre». Residual conocido:
ManyChat dice que el sábado abre a las 10:00 y Luis entra a las 9:00).

🔴 **Y cargar los SID reales destapó un bug de diseño mío.** Con los cuatro miembros del equipo
activos, el briefing de las 9:00 le llegaba **a los cuatro, los siete días**. Juan Alfonso cubre
sólo el martes: seis resúmenes inútiles por semana. Luis no trabaja martes ni domingo: dos más.
Un resumen diario para quien trabaja un día a la semana no es información, es ruido — y el ruido
es exactamente cómo muere un tablero.

La causa era una simplificación mía: el briefing estaba en `IGNORAN_HORARIO` junto con `reagendo`.
Ese conjunto existía por una razón buena —si mirara la hora, alguien cuyo turno empieza a las
10:00 nunca recibiría el de las 9:00— pero la respuesta correcta no era «no mirar nada»:
**la pregunta es «¿trabajas hoy?», no «¿estás en turno a las 9:00?»**. Ahora `briefing` filtra por
DÍA (`trabajaHoy`) y `reagendo` sigue sin filtrar nada. Resultado con el equipo real:

```
dom  Gabriel, Roberto        lun  + Luis        mar  + Juan Alfonso (sin Luis)
mié a sáb  + Luis
```

Tests: 41 aserciones en `equipo-horarios` (antes 36), con el martes real como caso explícito.

### 2026-08-20 (b) · El Kanban «6 · Falta responder»: la conversación que el bot no pudo resolver deja de perder el rastro

Gabriel: *«una cola de todas las solicitudes que requieran la intervención de un humano, tipo
kanban, y así podemos dejar registrado el hecho de que un humano haya respondido y marcar qué
pasa con ese lead. En la conversación de ayer, la persona entró en la cola de llamados y quedó
sin interés, pero esos datos nunca se registraron en Airtable.»*

**El hueco.** `Avisos` registraba que el bot pidió ayuda, pero **nada de lo que pasaba después**:
ni quién respondió, ni cuándo, ni en qué terminó. El rastro se cortaba justo donde empieza el
valor.

**Pantalla 6 de «Operación Llamadas (V2)»** (`pag4VY9lp3n8LpZzr`), Kanban sobre `Avisos`
agrupado por el campo nuevo **`Salida`**: `Pendiente · Respondido · Pasó a llamada · Sin interés ·
Spam / no aplica`. Mismo principio que el Kanban de Luis — **arrastrar la tarjeta ES registrar
lo que pasó**, un solo gesto, sin formularios. Campos nuevos: `Salida`, `Atendido por`, `Notas`,
`Llamado` (link a la tabla `Llamados`, que cierra el circuito aviso → ticket) y **`Respuesta
(min)`**, que mide la velocidad de atención humana **sin ninguna automatización** porque cuelga
de `LAST_MODIFIED_TIME({Salida})`.

**Las definiciones de cola se centralizaron.** `COLA_LLAMADOS` y `COLA_AVISOS` viven ahora en
`lib/avisos.js` y las importan el briefing, el barrido y el dedup. Tener la pregunta «¿esto
todavía espera acción?» escrita en tres archivos era la forma exacta en que volvería el bug de
los 13 días. Guarda nueva: **ningún endpoint puede escribir la fórmula a mano.** `Resuelto` se
conserva como escape manual — sólo puede sacar cosas de la cola, nunca meterlas, así que no
puede producir fantasmas.

**Backfill: las 8 filas existentes quedaron en `Pendiente`**, que es la verdad — de ninguna hay
registro de que un humano haya respondido. No adiviné desenlaces: se corrigen arrastrando, que
es justamente de lo que se trata el tablero.

Verificado contra Airtable: las dos fórmulas son válidas y devuelven 8 y 1 registros. Tests:
16 suites, verde.

### 2026-08-20 · Los horarios reales del equipo, y la distinción que evita que el bot mienta

Gabriel entregó los turnos: **Luis** lunes + miércoles a viernes 9–20 y sábado 9–15;
**Juan Alfonso** cubre el martes 9–20; **Gabriel y Roberto** reciben avisos **todos los días
de 8 a 20**. Cargarlos destapó una distinción que el diseño del día anterior no tenía.

🔴 **Quién ATIENDE ≠ quién RECIBE el aviso.** La promesa que el bot le hace al cliente salía de
la unión de los turnos de quien recibe avisos de «Llamadas». Con Gabriel y Roberto recibiendo
los siete días, esa unión cubre el domingo — y el bot habría prometido respuesta un domingo a
las 10:00 porque Roberto estaba de turno. Campo nuevo **`Atiende clientes`** en `Equipo`: sólo
esas filas entran en el cálculo. Y **no exige `SID ManyChat`** a propósito: Juan Alfonso atiende
los martes aunque todavía no esté cableado en ManyChat, así que el martes cuenta para la
promesa aunque el aviso de ese día sólo le llegue a Roberto.

**La promesa ahora nombra el día.** Pedido textual: *«si alguien escribe un domingo a las 3 AM,
se le dice: nuestro especialista te responderá mañana (lunes) apenas llegue»*. Antes decía sólo
«mañana». `promesaAtencion()` se movió a `lib/avisos.js` y la comparten los dos usos —llamada y
respuesta por chat—, que sólo difieren en el texto de «hay alguien ahora» («en los próximos
minutos» vs «en un rato»). Dos copias del cálculo de horario era exactamente la enfermedad
curada el 2026-08-06.

**`aviso-humano` devuelve `promesa`.** Hasta ahora el bot NO prometía plazo a propósito, porque
no sabía calcularlo. Ahora sí. ⏳ Falta mapear `$.promesa` en ManyChat y usarlo en el copy de
AB-3 y T-2 — trabajo manual.

**La sección del briefing se llama `🆘 FALTA RESPONDER`** (antes «SIN RESPONDER»): el título es
la acción, en imperativo, con las palabras que usó Gabriel.

**Verificado contra la tabla real de Airtable**, hora por hora de toda la semana: los domingos y
de 20:00 a 08:00 no recibe nadie (queda para el briefing), el martes sólo Roberto hasta que
llegue el SID de Juan Alfonso, y las diez promesas de borde salen correctas. Tests: 321
aserciones, verde.

⚠️ **Faltan dos SID de ManyChat: Juan Alfonso y Gabriel.** Sus filas están activas y con horario
correcto, pero sin id no reciben el WhatsApp. `destinatarios()` los reporta en `sinSid` para que
el silencio no sea invisible.

### 2026-08-19 · Auditoría del sistema de avisos: dos entradas comunes, horario por persona, y seis bugs vivos

**Lo que la disparó.** Gabriel: *«¿por qué le está llegando este mensaje a Luis, sabiendo que
esas personas ya fueron contactadas y están marcadas como sin interés?»* — el briefing de la
mañana listaba a Rodrigo Riquelme como «por llamar, esperando 13d» pese a estar cerrado.
Y, de paso, el pedido de fondo: **una entrada común para todos los avisos**, con **horario por
persona** y **red al briefing** para lo que entra fuera de turno.

Se auditó con 6 lentes independientes + un escéptico por lente (42 hallazgos confirmados,
5 descartados). Los seis que estaban vivos en producción:

🔴 **1. El briefing leía la cola por el campo equivocado.** `{Estado}='Llamada pendiente'`.
Pero `Estado` no es el campo que toca Luis: Luis arrastra la tarjeta y eso escribe `Salida`.
`Estado` era un espejo que `salida-llamado` sincronizaba **al final** de la función, y **dos
caminos se iban antes**: `sin_lead` (tickets sin Lead enlazado — los que el staff crea con el
«+»; 4 de los 5 tickets vivos eran así) y `ya_enviado` (los que ya mandaron un mensaje al
cliente, p. ej. tras «No contestado»). Verificado en `recCkAybRN6Udjb7c`: `Salida='Sin interés'`
+ `Estado='Llamada pendiente'` + cero PATCH. **Arreglo en dos mitades:** el espejo se escribe
ahora en un PATCH propio **antes de cualquier return temprano**, y briefing, barrido y dedup
leen la cola por **`Salida`** — el campo del operador. Aunque el espejo se rompa otra vez, la
cola no miente.

🔴 **2. `mc-llamado` reventaba con 500 en su rama más valiosa.** La constante `nombre` se
declaraba 24 líneas DESPUÉS del bloque de dedup, que la usaba en el texto «🔁 VOLVIÓ»: zona
muerta temporal → `ReferenceError`. Reproducido contra el código de HEAD. Se disparaba justo
con el lead que **ya dejó su número y vuelve a preguntar por otra bici** — el más caliente del
embudo —, y ManyChat recibía un error en vez de la confirmación.

🔴 **3. El botón «Sí, llámenme» nunca encontraba el ticket.** La consulta era
`FIND('<leadId>', ARRAYJOIN({Lead}))`. **En una fórmula de Airtable un campo de enlace se
evalúa a su valor VISIBLE, no al record id**, así que daba 0 filas SIEMPRE: todo el que
apretaba el botón caía en `sin_ticket` y se derivaba a un humano, con su ticket ahí al lado.
Comprobado contra la base: `FIND('recd22Zyk…', ARRAYJOIN({Lead}))` → 0 · `FIND('nspringm2020',…)`
→ 1. Ahora se usa el **enlace inverso `Leads.Llamados` + `RECORD_ID()`**.
⚠️ Los 16 tests de `mc-rellamar` pasaban en verde: el mock respondía a *cualquier* consulta.
Ahora el mock es **estricto** (sólo contesta si la fórmula usa `RECORD_ID()`), y hay guarda.
*(Sí vale `ARRAYJOIN` sobre un **lookup** del RecID — lo que hace `mc-waitlist` con
`{Lead RecID}` —, porque ahí lo que se junta ya son ids. Verificado.)*

🔴 **4. Sellos escritos sin mirar si la escritura entró.** `cron-avisos` y `cron-sourcing`
hacían el PATCH del sello y seguían. Si Airtable lo rechazaba, el registro quedaba sin sello y
el barrido **reenviaba el mismo aviso cada 15 minutos, para siempre**. Ahora se verifica; en
`cron-avisos` un sello fallido gasta un intento para que el freno de 3 lo detenga.

🔴 **5. Un fallo de lectura se veía igual que «no hay nada».** `leerTodo` del briefing hacía
`break` y devolvía la lista vacía: con el token vencido, el briefing habría dicho **«nada
pendiente 🌱», en verde y con `ok:true`**, todas las mañanas. Ahora la falla viaja en el
mensaje («⚠️ NO SE PUDO LEER Solicitudes») y en la respuesta.

🔴 **6. `mc-agenda` tenía el `try` fuera del bucle de destinatarios** — el mismo bug de
tormenta que se corrigió en los otros seis emisores el 2026-08-06. Sobrevivió porque el regex
de la guarda se cortaba en la primera llave y un template literal lo cegaba. Guarda arreglada
(ventana de 1200 caracteres) y el envío pasa por `avisar()`.

**Las dos entradas comunes** (lo que pidió Gabriel). `functions/api/aviso-llamada.js` =
«alguien dejó su teléfono» y `functions/api/aviso-humano.js` = «esto necesita a una persona».
`mc-llamado` y `mc-aviso` quedan como **alias** que apuntan ahí, así que **ningún flujo de
ManyChat hay que tocarlo** y las claves de respuesta que mapea el bot (`promesaLlamada`,
`dentroDeHorario`, …) se conservan. Las dos aceptan **`handle` · `subscriber_id` · `telefono`**:
antes exigían el @handle de Instagram, así que un lead de WhatsApp o de la web moría en 404 o
nacía huérfano (sin Lead enlazado y fuera del rollup «Terminó en venta»). El **canal** viaja y
queda escrito, y el aviso lleva **contexto del CRM**: qué bicis vio y con qué resultado,
cuántas veces volvió, qué preguntó la última vez.

**Horario por persona — tabla `Equipo`.** `Nombre · SID ManyChat · Horario · Recibe · Activo`.
Formato `1-5@9-20|6@10-15`, hora de Chile, `hasta` exclusivo. Vive **sólo** en `lib/avisos.js`
(la lógica por persona se había borrado el 2026-08-06 justo por estar copiada seis veces).
**Sin la tabla, o con todos inactivos, el sistema se comporta exactamente como antes** — envs
`AVISO_*_SIDS` + franja 9–20 —, y el fallback es **por tipo**. Se sembró con Luis y Roberto
**desactivados**: activar es marcar una casilla, sin desplegar. `promesaLlamada` pasa a salir
de la **unión de los turnos de quien recibe Llamadas**, para que «cuándo te llamamos» sea
«cuándo hay alguien a quien le llega el aviso».

**El briefing pasa de 2 secciones a 5**, y el título de cada una **es la acción pendiente**:
📞 POR LLAMAR · 🆘 SIN RESPONDER · 🔎 POR BUSCAR · 🚲 POR EVALUAR · 📅 VISITAS DE HOY. Antes
sólo miraba llamados y visitas: **encargos, consignaciones y las conversaciones que el bot
derivó a un humano se acumulaban sin que ningún briefing las nombrara.** Si el bot no entendía
un mensaje a las 23:00, a la mañana siguiente no se enteraba nadie. Sella **las cuatro colas**
(antes sólo llamados; lo que no cupo se deja sin sellar a propósito para que el barrido lo
mande individualmente), presupuesto compartido en orden de urgencia, ventana de 7 días para
«SIN RESPONDER», y la espera se cuenta **desde el reencolado**, no desde la creación.

**`Avisos` pasa a ser una cola de verdad** (`Canal`, `Subscriber ID`, `Aviso equipo enviado`,
`Intentos aviso`, `Resuelto`) y entra al barrido como cuarta cola. **Backfill de las 8 filas
existentes** — sin él, el primer barrido las habría re-avisado todas de golpe.

**Limpieza:** se borraron los helpers de ManyChat duplicados en `mc-agenda`, `mc-waitlist` y
`mc-consigna` (~4,5 KB) y **ninguna función lee ya `AVISO_*_SIDS` ni `LUIS_SUBSCRIBER_ID`
directo**: los destinatarios salen sólo de `lib/avisos.js`. `mc-consigna` usa CRLF (el resto
LF); se preservó.

**Tests: 16 suites, todas verdes.** Nuevas: `equipo-horarios` (29) · `aviso-llamada` (34) ·
`aviso-humano` (22) · `cron-briefing` (29). `guardas-avisos` pasa de 7 a **13 guardas** —
incluidas «la cola se lee por `Salida`», «el espejo se escribe antes de los returns tempranos»,
«`nombre` se declara antes de usarse» y «nadie busca por `ARRAYJOIN` de un campo de enlace».
`promesa-llamada` deja el truco de `readFileSync` + `new Function` y se importa de verdad.

⚠️ **Hallazgo que NO es código:** la automatización **«Sello de 1ª llamada · Llamados» tiene el
arreglo del 2026-08-07 en BORRADOR, sin publicar**. Lo que corre en vivo sigue colgando de
`Estado` y copiando `_ahora`, así que **`Espera (min)` sigue vacío para todo ticket que pasó
por «No contestado»** — exactamente el bug que el CHANGELOG daba por resuelto. Se arregla
publicando el borrador en Airtable (un clic; la API no publica automatizaciones).

📕 As-built completo: [`docs/V2_AVISOS.md`](docs/V2_AVISOS.md).

### 2026-08-18 · El DM vacío del reel nuevo, y «Donde perdió puntos» en una bici 7/7

**El síntoma.** Se duplicó la automatización de comentarios para un reel nuevo
(`DcKeikhxRcf`) cambiando las fotos y la URL de la ficha, y el DM grande salió casi vacío:
todos los `cf_bici_*` en blanco.

**La causa: faltaba la fila en `Reels`.** Es el paso 1 de la duplicación (§6 de
`docs/V2_PLANTILLA_COMENTARIOS.md`) y el único que no vive en ManyChat, así que es el que se
olvida. `mc-evento` resuelve la bici **solo** por ahí: `body.reel` → `Reels.{Post ID
Instagram}` → link `Bici` → `Inventario`. Sin esa fila no encuentra nada, **no falla**, y
responde `200 OK` sin ningún campo `bici*`; el mapeo de ManyChat no tiene qué copiar y los
campos quedan vacíos. 🔴 **Es una falla silenciosa por diseño** (best-effort: el evento igual
se registra). La huella queda en Airtable: un Interés de Puerta 1 con «Ficha entregada» y
**sin `Reel` ni `Bici`** — así se reconoce desde el CRM sin mirar ManyChat.

**Enlazadas de paso**, porque tenían el mismo problema latente: `Dbe7BA3BY3l` → Kenevo Expert
6Fattie · S3 (identificada por las specs del caption: ZEB Ultimate + Super Deluxe Coil +
frenos Hope, que solo calzan con esa unidad) y `DawQ95EO5mn` → Tarmac SL6 S-Works · 54 (el
caption dice **SL6**; la SL7 está vendida). ⚠️ **`Dbe7E81ByNL` sigue SIN bici**: su caption es
de una **Levo Comp Carbon** y en Inventario las dos Levo Comp son **Alloy**. Enlazarla a la
Alloy mandaría la ficha de otra bici —otro cuadro, otro precio— a quien preguntó por esa.

**El fix de código — `areaMasBaja` devuelve vacío cuando no hay área más baja.** El desglose
de las unidades impecables trae 7/7 en las cuatro áreas; el mínimo caía siempre en la
**primera línea** y el DM decía «Donde perdió puntos: Cuadro y Estructura» de una bici
perfecta — el mensaje de honestidad diciendo una tontera. Ahora, si ninguna área está por
debajo de otra, el campo va vacío (mismo contrato que `biciBateria` en las musculares: el
campo no viene y ManyChat omite el renglón). El empate en el mínimo **sí** nombra área
(Kenevo: 6.9/6.9/6.8/6.8 → «Suspensiones»). Cubre también el desglose de una sola línea: no
hay con qué compararla. Tests reales en `test/mc-evento-bici.mjs` (Stumpjumper 7/7 → vacío ·
Kenevo → Suspensiones). ⏳ **Falta montar la condición en ManyChat** (`cf_bici_area_baja` no
vacío), o queda un «Donde perdió puntos:» colgando.

**Lo que NO era el problema, y confunde:** cambiar la foto y la URL de la ficha a mano en los
bloques. La foto sale de `Fotos galería` y `cf_bici_ficha` la calcula el endpoint como
`slug(Modelo-Talla)`. La URL sí hay que cambiarla, pero **solo** porque el botón «Ver Ficha»
de B2 quedó as-built con URL fija (ver `docs/V2_CONSTRUCCION_COMENTARIOS.md`) — eso no
alimenta nada del texto.

**Pendiente de dato:** las 5 unidades cargadas hoy tienen **`Precio nuevo` vacío**, así que
«Nueva hoy sale ___ → te ahorras ___» sale mocho en los tres reels recién enlazados.

### 2026-08-18 · Las 5 que faltaban de biketrust.cl, y `/bicis.json` para el tablero

**El cruce.** Se comparó el inventario de `biketrust.cl` (el sitio Ailoo) contra el nuestro,
**por `Referencia`**, que es la única llave común (ver `docs/AILOO_INTEGRACION.md`). Ailoo
tenía **25 bicis vivas** (13 e-bikes + 6 MTB + 6 ruta, sin paginación; el link a «Turbo Levo
L rojo» de su portada da 404). De esas, 14 emparejaron por `Referencia` exacta y 6 por
nombre — las vendidas antiguas, que en Airtable nunca tuvieron `Referencia` cargada; en 5 de
esas 6 el precio coincide al peso, así que el emparejamiento es firme.

**Faltaban 5**, todas cargadas hoy como `Disponible`:

| Referencia | Modelo | Talla | Precio | Slug |
|---|---|---|---|---|
| 4104032 | Turbo Creo 2 Comp 2024 | M | $4.400.000 | `turbo-creo-2-comp-m` |
| 4104027 | Stumpjumper 15 Alloy 2025 | S4 | $2.000.000 | `stumpjumper-15-alloy-s4` |
| 4100676 | Epic 7 S-Works 2022 | M | $4.500.000 | `epic-7-s-works-m` |
| 4100649 | Tarmac SL6 S-Works | 54 | $5.500.000 | `tarmac-sl6-s-works-54` |
| 4099956 | Kenevo Expert 6Fattie 2021 | S3 | $3.900.000 | `kenevo-expert-6fattie-s3` |

Detalles que valen para la próxima carga desde Ailoo:

- **La talla la manda la DESCRIPCIÓN, no el atributo del producto.** Ailoo trae un `Tamaño`
  genérico que contradice el texto: la Kenevo dice `M` en el atributo y **S3** en la ficha, y
  la SJ 15 dice `L` y **S4**. Se usó el S-Sizing de la descripción, que es el que Specialized
  imprime en el cuadro.
- **Los modelos se nombraron para no chocar de slug** con los que ya existían (`Kenevo
  Expert S3`, `Stumpjumper 15 Comp Alloy M`, `Tarmac SL7 S-Works`). Ninguna quedó con
  sufijo `-2`.
- **Fotos sin blanquear, por pedido.** Las 34 vienen del CDN de Ailoo (`biggy.cl`, `_900` es
  el máximo que sirve; 900×900) y **no** se creó carpeta en `assets/fotos/`, así que el build
  las toma de Airtable tal cual. Verificado por MD5: el archivo que publica el sitio es
  byte-idéntico al de `biketrust.cl`.
- **`Origen` y `Precio nuevo` quedaron vacíos**: no existen en la ficha de Ailoo.
- **La ficha de la Creo 2 en `biketrust.cl` está publicada con los placeholders sin llenar**
  (dice literalmente `[Insertar Talla Aquí]` y `[Insertar Altura Aquí]`, a la vista del
  público). La talla salió del atributo; **`Rango altura` se dejó vacío** en vez de inventarlo.

**Desincronización detectada, sin tocar:** 8 bicis marcadas `Vendida` acá siguen publicadas
como *In stock* en `biketrust.cl` (refs 3945820, 4047084, 4047085, 4051339, 4060064, 4060065,
4082599, 4095015). Y al revés: `Aethos Comp L` (4097779) y `Tero 4.0 M` (4097781) existen
solo acá — **y están `Disponible` sin ninguna foto**.

**`/bicis.json`.** El build publica ahora un manifiesto del catálogo: `ref`, `slug`, modelo,
talla, año, disciplina, precio, puntaje, estado, foto de portada y **las dos URLs de página**.
🔴 **`pagina` (`/bici/<slug>`) y `fichaTecnica` (`/ficha/<slug>`) NO son lo mismo** —
la primera es la vitrina pública con galería y CTA, la segunda es la imprimible con todos los
datos, la que manda el bot. La primera versión de esto publicó solo una clave llamada `ficha`
que apuntaba a `/bici/`, y el tablero terminó abriendo la vitrina cuando el botón decía
«ficha técnica». `ficha` quedó como alias histórico de `pagina`. Existe
porque el tablero necesita foto y link, y **ninguno de los dos se puede reconstruir afuera**:
el slug se desambigua por ORDEN del catálogo (`-2`, `-3` cuando dos comparten modelo+talla) y
la extensión de la portada depende del archivo que subieron a Airtable. Encima, las URLs de
adjuntos de Airtable **expiran**, así que hornearlas en otro repo daría fotos rotas en horas.
Acá el dato es el real porque lo acaba de escribir este mismo build. No expone nada que no
esté ya en `/catalogo`.

### 2026-08-15 · Portada más corta, chip del hero usable en teléfono y el logo al compartir

Pedidos de Gabriel, todos sobre la portada. Tres commits.

- **Fuera tres secciones** (`421d180`): «El sello lo firman personas» (con la banda de
  Garantía Bike Trust y las 3 fotos pendientes de taller), «48 horas» y «La diferencia».
  Con ellas se fueron el JS de contadores de `#bt-strip`, las variables de la bici de
  muestra (`bikeMuestra` sigue viva en `/como-certificamos`) y, después, **43 líneas de CSS
  huérfano** (`.strip3` · `.figure3` · `.steps3` · `.vs` · `.band-dark`) que se emitían en
  las 8 páginas. ⚠️ La portada ya **no menciona la garantía** en ninguna parte.
- **Titular nuevo en las tres vías de compra** (`8ee796e`): el kicker «Delega lo que
  quieras» pasó a ser un `h2` centrado, «Te ayudamos a encontrar la bici de tus sueños», y
  las cards se renombraron a «Búscala en el catálogo» · «Te ayudamos a elegir» · «Si no
  está, la conseguimos». Enlaces y `data-cta` intactos.
- **El chip del hero tapaba la bici en teléfono.** Medido en 375px: **283×258 px = 75% del
  ancho y 60% del alto** de la foto, y los puntos del carrusel le caían encima (se cruzaban
  entre 244 y 297 px). Nuevo bloque `@media (max-width:640px)`: se ocultan las **4 barras
  del desglose por área** (a 9px eran ilegibles y costaban ~110px de alto), baja la
  tipografía (modelo 23→19, puntaje 30→24) y los dots se van **arriba a la derecha**.
  Queda en **248×135 px (66% × 31%)**, con modelo, talla, precio, puntaje /7 y el link a la
  ficha. Desktop sin tocar.
- **Al compartir sale el logo, no una bici.** El `og:image` por defecto era
  `/assets/img/hero-trail.jpg` (foto de stock) y la portada lo pisaba con la foto de la
  primera destacada — por eso WhatsApp mostraba una bicicleta. Ahora hay una tarjeta
  **`assets/brand/og-card.png`** (1200×630, lockup bronce sobre `--dark`, 81 KB) y es el
  default de `HEAD()`. Las 7 páginas generales la usan; **`/bici/<slug>` conserva la foto de
  su bici a propósito** (`og:type=product`) porque es el link que manda el embudo y ahí el
  preview de la unidad sí sirve.

### 2026-08-15 · La garantía entra al sitio (portada y ficha) y el certificado pasa a oscuro

Gabriel entregó el documento oficial **«Garantía Biketrust v2»** y pidió que el sitio la
muestre. Se agregó en dos lugares, con el contenido del doc y sin inventar plazos.

- **Orden de la portada en teléfono:** se eliminó `@media (max-width:920px){.hero-txt{order:2}
  .hero-visual{order:1}}`. Ahora manda el orden natural del DOM: titular y CTAs primero, el
  **carrusel justo debajo**, después «Te ayudamos a encontrar…», la vitrina y la garantía.
  Desktop sigue lado a lado.
- **Sección «Garantía Bike Trust» en la portada**, después de «Cuatro certificadas»: tres
  cifras (6 meses de reparación sin costo · 18 meses de recompra · Ley 19.496, que la
  voluntaria no reemplaza) + qué cubre / qué no cubre + pie legal. CTA propio a WhatsApp con
  `data-cta="garantia"`, valor que se agregó a la lista blanca de `functions/api/clic.js`.
- **Sección «Garantía» en la ficha de bici** (`#garantia`), inmediatamente después de
  Certificación y con folio propio, así que los números de sección se corrieron (01
  Certificación · 02 Garantía · 03 Diagnóstico…). En las fichas sin puntaje la garantía queda
  como 01: aplica igual.
- **El certificado ahora es oscuro** (`.certbox` sobre `--dark` con textos en `--darktext` y
  acentos bronce). Era crema sobre crema y no destacaba; es la pieza que la ficha debe hacer
  brillar. **Se le quitó el link a WhatsApp** («Pregúntanos por el certificado») a pedido de
  Gabriel: el certificado se lee, no se conversa. El riel sticky de la ficha conserva su CTA.
- **Copy del hero, reescrito** (opción elegida por Gabriel entre tres): kicker «Taller propio ·
  Las Condes, Santiago», titular «Specialized usadas, certificadas. *Compra con confianza.*» y
  bajada que **nombra al enemigo** — «Se acabaron los días de comprarle a un desconocido en un
  estacionamiento oscuro. Acá cada bici pasa por nuestro taller, se califica de 1 a 7 y sale
  con garantía por escrito». Referencia: la tienda gringa (The Pro's Closet) que se investigó
  para el rediseño. El `h1` bajó de `clamp(42px,4.8vw,70px)` a `clamp(40px,4.4vw,55px)` porque
  «Compra con confianza.» partía en dos líneas: la columna del hero mide ~460px sin importar
  el ancho de pantalla (el padding izquierdo crece con la ventana), así que el tope manda.
- **«Te calza si mides» → «Ideal si mides»** en el calce de la ficha.
- 🔴 **El cuadro en blanco de las fichas: un selector demasiado abierto.** `.hon .ev span`
  estaba pensado para el marco 1:1 de cada miniatura, pero también alcanzaba al
  `<span class="lab-s">` del rótulo «Fotos de esta unidad» — que además está en
  `grid-column:1/-1`. Resultado: un **cuadrado blanco de 176×176 px** encabezando la columna
  de fotos en **15 de las 22 fichas**. Ahora la regla es `.hon .ev button>span`. El rótulo
  pasó de 176px a 14px de alto y el bloque de fotos de ~374px a 198px.
- **Fuera la línea de dirección del hero** (`AV. LAS CONDES 12461 · SANTIAGO · +56 9 8523 2895`)
  y su CSS `.hero .dir`, sin otro uso. La dirección sigue en la barra superior y en el pie.
- 🔴 **Scroll trabado en teléfono (reporte de Gabriel) — cuatro causas removidas.** La de fondo
  es real y estaba a la vista: el envoltorio de la portada llevaba `overflow-x:hidden`, y en
  CSS basta que **un** eje deje de ser `visible` para que el otro compute `auto` → ese `div`
  era un **contenedor de scroll de 7.146px** envolviendo casi toda la página, dentro de un
  documento de 8.257px. Un contenedor anidado que no puede scrollear se traga el gesto táctil
  y el scroll se siente pegado. Ahora usa **`overflow-x:clip`**, que recorta igual pero **no**
  crea contenedor de scroll (verificado: `overflow-y` volvió a `visible` y no queda ningún
  contenedor scrolleable en la página). Además, bajo 920px se apagaron tres cosas que en gama
  media obligan a recomponer en cada cuadro: el **`backdrop-filter:blur(10px)` de la barra
  pegajosa** (ahora fondo opaco), el **blur del chip del hero** y la **animación infinita
  `bt-float`** de la foto; y el **parallax por scroll** quedó restringido a ≥921px.
  ⚠️ No se pudo reproducir en un teléfono real (el navegador de la herramienta no compone
  frames y no scrollea ni en páginas sanas): esto elimina las causas conocidas, no es una
  verificación en dispositivo. Si sigue pasando, hay que identificar la sección exacta.
- ⚠️ **Lo que NO se publicó, a propósito:** el doc trae `[plazo, por ejemplo: 5 días hábiles]`
  para responder la recompra y `[dirección / teléfono / correo]` en el punto 5 — sin llenar,
  no se publica una promesa de tiempo. Y el propio documento dice **«sujeto a revisión legal»**:
  el sitio muestra los términos resumidos, no el texto íntegro. Cuando esté revisado
  corresponde una página `/garantia` con el documento completo.

### 2026-08-14 · Medición del sitio: la Puerta 3 deja de ser una fila de guiones

El tablero mostraba `—` en las cuatro etapas de la cadena de la ficha. No era un bug: **nada
en el sitio las emitía**. Este cambio construye la fuente.

- **`/api/clic` + D1 `biketrust-medicion`.** Una tabla, dos tipos de evento: `vista` (con la
  `Referencia` de la bici cuando la página es una ficha) y `clic` (con el `cta`). Eso responde
  las dos primeras preguntas de la cadena: *cuánta gente entra por bicicleta* y *cuántos
  aprietan «recibir la ficha»*.
- **Los 4 botones quedaron separados** — `ficha`, `encargo`, `consigna`, `general` — porque
  tres de ellos cortan ahí y derivan a la llamada de Luis, y solo el de la ficha sigue la
  cadena larga. La ficha además distingue el botón grande del riel (`ficha`) del de la barra
  superior (`ficha_top`): son dos botones para lo mismo y ahora se sabe cuál trabaja.
- **El beacon vive en `FOOT`**, que cierra las 8 páginas, así que no hay página sin medir.
  23 CTA etiquetados con `data-cta` en `build.mjs`.
- **Sin dato personal, a propósito.** Ni IP, ni cookie, ni user-agent guardado, ni huella. El
  id de sesión vive en `sessionStorage` y muere al cerrar la pestaña. Por eso esto no obliga a
  banner de consentimiento ni cae bajo la ley 21.719 — y por eso tampoco sirve para seguir a
  una persona entre visitas, que es el precio aceptado.
- **No puede romper el sitio.** Sin binding, con JSON malo o con la escritura caída responde
  204 igual. Probado: SQL en el cuerpo queda guardado como texto (bind parametrizado), un
  `cta` inventado cae en `otro` en vez de perderse, una página de 400 caracteres se recorta a
  120, y Googlebot no escribe.

⚠️ **Todavía no guarda nada**: faltan el binding `DB` y la env `MEDICION_KEY`, que son de
panel. Ver `CLAUDE.md` §8. Y ojo: **las dos etapas siguientes de la cadena** («se les envió la
ficha» y «aceptaron que los llame un experto») pasan por ManyChat, no por el sitio — este
endpoint no las puede llenar.

### 2026-08-13 · Puente Ailoo → Inventario: se acaba la digitación doble

**Qué cambió.** Se escribió el requerimiento técnico para los desarrolladores de Ailoo
(`…/2. Fragua/Requerimiento_tecnico_Ailoo.docx`) y **el lado nuestro completo**:
`functions/api/ailoo-bici.js`. Cuando Luis carga una bicicleta en el ERP, esta llega a
Airtable con todos los campos de la ficha mapeados y el sitio se reconstruye solo.

**Las decisiones que importan:**
- **`Referencia` es la llave.** Ya existía y es pública: número de 7 dígitos único **por
  unidad**, verificado 12/12 contra Inventario. No hubo que pedirle a Ailoo que inventara un
  identificador, y el upsert queda idempotente (reintentar es seguro).
- **Ailoo manda datos planos; nosotros componemos los strings con formato.** `Rango altura`,
  `Desglose puntaje` y `Specs clave` son texto con estructura que leen `build.mjs` y
  `mc-match`. Pedirle a Ailoo que respetara esos formatos era volver a depender de digitación
  perfecta. Al recibir números sueltos y una línea por ítem, **el contrato con Airtable no
  cambia en nada**. Detalle en [`docs/AILOO_INTEGRACION.md`](docs/AILOO_INTEGRACION.md) §2.
- **`test/ailoo-bici.mjs` extrae los parsers REALES** de `build.mjs` y `mc-match.js` y les
  pasa lo que componemos. Si alguien toca `parseSpecs`, `desgloseRow` o `parseRangoAltura`,
  el test cae antes de que se rompa una ficha en producción.
- **El estado nunca pisa una `Reservada`** (hay una seña de por medio). El stock solo mueve
  `→ Vendida` y el regreso desde `Vendida`/`Borrador`/`En reacondicionamiento`.
- **Las fotos solo se ingieren si la galería está vacía**, para no borrar las curadas a mano,
  y van en `waitUntil`: bajar seis imágenes no cabe en los 3 segundos de respuesta
  prometidos. Recordar que Airtable **no puede** bajarlas por URL desde el CDN de Ailoo (falla
  en silencio) — hay que subir el binario por `uploadAttachment`.
- **Campo `Color` creado** en Inventario (`fldM4X0iqZY22BeZp`): Ailoo ya lo tiene y no había
  dónde recibirlo.

**Alcance del requerimiento enviado:** solo el alta y la actualización. Quedaron **fuera** a
pedido de Gabriel el traspaso del dominio y la venta con teléfono del comprador.

**Verificado.** `npm test` en verde (226 asserts) + E2E contra Airtable de producción con una
bici sembrada y borrada por id: alta, idempotencia, cambio de precio, `stock 0 → Vendida` con
fecha, `Reservada` respetada y `401` con clave mala. Limpieza confirmada en 0 registros.

**⚠️ Falta para que esté vivo:** desplegar, y setear en Cloudflare `AILOO_KEY` (sin ella el
endpoint queda ABIERTO, igual que los `mc-*`) y `DEPLOY_HOOK_URL` (sin ella el sitio no se
reconstruye solo, que es todo el punto). Ver `docs/AILOO_INTEGRACION.md` §5.

### 2026-08-14 · Las 110 fotos, con fondo blanco de catálogo

**Qué se hizo.** Se le quitó el fondo real (vereda, seto, adoquines, muro del taller) a las
**110 fotos** del inventario y quedaron sobre **blanco puro**, a 1200x1200, con la bici
encuadrada al mismo tamaño y el mismo margen en todas. Modelo: **BiRefNet** (`rembg`,
`birefnet-general`) corriendo local en CPU, ~20 s por foto, 30 min el lote completo.

**El dato que define el límite (medido, no supuesto).** En estas fotos la bici ocupa ~680 px
de ancho, así que **un radio de rueda mide 0,8 px**: no existe un solo píxel que sea «puro
radio», todos son mezcla de radio y fondo. Se verificó además que los originales guardados en
Airtable **también son 900x900** — no hay más resolución en ninguna parte. Conclusión: ninguna
herramienta, gratis o pagada, puede recortar los radios de estas fotos. **Las ruedas quedan sin
radios y es irreversible con este material.** En llanta de perfil alto (Creo, Roubaix, Diverge)
casi no se nota; en MTB de llanta angosta (Epic) sí.

**Mitigación aplicada:** limpieza de la máscara con `scipy.ndimage.label` — se descartan los
fragmentos con menos del 0,4 % del área del objeto principal. Eso eliminó las **manchas negras
sueltas** que quedaban donde estaban los radios (el peor defecto de la primera pasada). Queda un
resto de radios pegado al buje delantero, que es donde el modelo sí alcanzó a verlos.

**Efecto secundario bueno:** el sitio **pesa menos que antes** — 10,8 MB contra 13,3 MB — pese a
que las imágenes son un tercio más grandes. El blanco plano comprime mucho mejor que un seto.
Promedio por foto: 102 KB a 1200x1200, contra 123 KB a 900x900.

**Arquitectura — dónde viven ahora.** `dist/` se borra y se re-descarga desde Airtable en cada
compilación, así que el retoque se habría perdido al desplegar. Se agregó **`assets/fotos/<slug>/`**
en el repo, que **manda por sobre Airtable**: si la carpeta existe, `resolveBikePhotos` la usa y
no descarga nada. El retoque se hace una vez en el escritorio (no se puede hacer en el build de
Cloudflare, que no procesa imágenes), viaja en el repo, y **Airtable conserva los originales
intactos**. Revertir = borrar la carpeta y recompilar.

⚠️ **Para la próxima tanda de bicis:** las fotos nuevas entran por Airtable sin retocar. Hay que
correr el script del escritorio y dejar el resultado en `assets/fotos/<slug>/`, o esa bici va a
salir con el fondo del taller mientras el resto está en blanco.

📸 **Lo que de verdad resuelve esto a futuro: fotografiar sobre blanco.** La pantalla verde que
se estaba considerando es **mala idea para bicicletas** — discos, bielas y aros pulidos son
espejos que reflejan el verde, y un cuadro negro contra verde queda con halo. Lo correcto es
fondo blanco mate con la bici a 1,5 m y el fondo sobreexpuesto: así el hueco del triángulo del
cuadro y el espacio entre los radios **ya son blancos en la toma** y no hay nada que recortar.
Truco más rentable: **pintar el pie de taller de blanco** (~$5.000).

### 2026-08-14 · La ficha de bici, rediseñada: vitrina + riel de compra que no se va

**Cómo se decidió.** No se eligió a ojo: se corrieron 11 agentes en un workflow —4 auditorías
independientes (composición · conversión · contenido/datos · robustez), 3 direcciones de diseño
opuestas y 3 jurados con criterios distintos (conversión al teléfono · oficio de diseño ·
implementabilidad). Ganó **«La Vitrina»** con 2 de 3 votos. El jurado de oficio prefería la
dirección «expediente» y vetó el punto débil de la ganadora —plegar la evidencia en acordeones—,
veto que se respetó: certificación, diagnóstico y estado honesto quedan **siempre visibles**.
*(El agente de síntesis murió antes de entregar; el plan final se reconstruyó desde el journal.)*

**Los tres defectos medidos que motivaron todo:**
1. 🔴 **Las fotos estaban mal montadas.** Las 900x900 de Ailoo traen **letterbox blanco** en
   proporciones MIXTAS (7 bicis con contenido 3:4, 5 con 4:3, 4 casi cuadradas). El contenedor
   era `4/4.2` + `cover` + fondo crema → recortaba contenido real en la mitad del inventario y
   dejaba el rectángulo blanco de la foto flotando sobre el crema. → **1:1 + `contain` + fondo
   blanco**: ninguna foto se recorta y el relleno se funde. La foto pasó de 508x533 a **622x622**.
2. 🔴 **Un solo CTA en 3.385px.** Tras el buybox venían ~2.600px de prueba sin una sola acción.
   → **riel `position:sticky`** que ocupa las dos filas del grid: el botón está en pantalla desde
   los 442px hasta el final, **sin una línea de JavaScript**.
3. 🔴 **Escala invertida.** La cifra del puntaje medía 130px contra un h1 de 58px. → h1 46 →
   certificado 44 → precio 40 → puntaje del riel 38. Ninguna cifra por encima del h1.

**Lo que se agregó:** ahorro real calculado contra `Precio nuevo` (la Creo muestra «Ahorras
$5.500.000 · 52% bajo el valor de nueva» — nunca se calculaba) · el **calce** (`Rango altura`)
como dato destacado del riel, y si falta, un enlace que pide la estatura por WhatsApp (el campo
por el que rutea el quiz de ManyChat) · sección **«Lo que todos preguntan»** con las 4 objeciones
caras (pago · prueba · regiones · garantía), cada una un toque a WhatsApp con mensaje propio ·
**estado honesto anclado a fotos** de esa unidad que abren el lightbox · diagnóstico con clave de
lectura por cifra y la batería como dato principal · **placa tipográfica** con datos reales y CTA
dorado para las 6 fichas sin foto · lightbox con teclado (Escape/flechas), z-index 90 para no
pelearse con el modal de reserva (100) · el WhatsApp del header sticky ahora lleva el mensaje de
ESA unidad · vendidas: banner + cierre con encargo y 3 certificadas equivalentes.

**Lo que se sacó por falso o vacío:** «EMITIDA · AGO 2026» (era la fecha del *build*, no de la
certificación) · «TE LA PREPARAMOS PARA MAÑANA» / «RESPUESTA POR WHATSAPP HOY» (SLA que nadie
garantiza) · las **barras del desglose** (los 48 datos reales caen entre 79% y 100%: no codificaban
nada y dibujaban un 6,0 como media barra vacía) · «Lo declaramos antes de que preguntes» (el campo
`Estado honesto` hoy trae elogios y repeticiones del diagnóstico, ningún defecto).

🔴 **Bug de TODO el sitio cazado de paso:** el `.msticky-space` se emitía **antes** del `<footer>`
en las 7 páginas, así que no compensaba nada y la barra fija móvil **tapaba la última línea del pie
legal en todo el sitio**. Se eliminó el espaciador y la compensación pasó a `.ft{padding-bottom:78px}`
bajo 920px — una sola mecánica para las 7 páginas, como exigió el jurado de ingeniería.

**Contratos intactos (verificado):** slugs `/bici/<modelo-talla>` sin cambios (22 en `/bici` y 22 en
`/ficha`), `fichaTecnicaHTML` byte a byte igual, payload de `/api/reservar` idéntico, `functions/`
sin tocar, y `.hon-grid`/`.hon-card` **conservados** porque los usa `comoCertificamosHTML`.

**Móvil:** la foto se capa a `50vh` para que el modelo entre en la primera pantalla (h1 a 747px de
812), y la barra fija lleva precio + puntaje + CTA desde el primer píxel, con estado (en Vendida
conmuta a «Una igual →»).

### 2026-08-13 · Rediseño del sitio («certificadas 3»): todo CTA converge en WhatsApp

**Qué cambió.** Se reemplazó el frontend completo del sitio por el rediseño que entregó
Gabriel (zip «Rediseño Bike Trust certificadas 3») — solo las plantillas dentro de
`build.mjs`; el pipeline de datos, `functions/` (avisos, mc-*, crons), `lib/` y
`worker-cron/` quedaron **intactos**. Páginas nuevas: portada con hero rotatorio de
destacadas, catálogo con filtros (disciplina/talla/precio), ficha nueva, `/encargo`
(nueva), `/como-certificamos`, `/consigna` y `/guias` (las 3 guías en una página con
anclas). `/visitanos` y `/guias/*` viejas redirigen vía `_redirects`.

**Decisiones clave:**
- **WhatsApp por tipo de entrada** (pedido explícito): general («Busco una Specialized
  usada certificada»), asesoría, ficha por bici (modelo+talla+ref), encargo (modelo/talla/
  presupuesto armados en vivo), parte de pago, consigna, dudas de certificación y de guías.
- **Vendidas se publican** (pedido explícito): al final del catálogo, en gris, chip
  «Vendida», ficha con banner «¿Llegaste tarde? Te conseguimos una igual» → `/encargo?modelo=…`.
  El build ahora lee la vista `Disponibles` + un fetch extra `Estado∈{Vendida,Reservada}`.
- **El modal de reserva se conservó** (funcionalidad existente, restilizada): mismo payload
  a `/api/reservar`, mismas reglas de fechas hábiles; correo sigue siendo obligatorio
  porque el endpoint lo exige (el diseño lo marcaba opcional).
- **Campo nuevo `Destacada`** (checkbox) en Inventario: gobierna el hero y «Cuatro
  certificadas» de la portada. Marcadas: Kenevo Expert · Levo 4G S-Works · Epic 8 Pro ·
  Creo SL S-Works (las mismas del diseño). Sin marcas, el build cae a las primeras 4 con
  foto y puntaje.
- **Contratos intocados:** slugs `modelo-talla` idénticos (mc-match reconstruye
  `/ficha/<slug>` — la ficha imprimible se genera igual que antes, byte a byte).
- **Apagado a propósito:** los 2 testimonios del diseño (flag `TESTIMONIOS_ON=false` en
  build.mjs) hasta confirmar que son clientes reales — citaban bicis aún en vitrina. Los
  copys con placeholders del diseño («[X] min», «[términos por definir]», el nombre del
  mecánico «Nicolás Rojas») se neutralizaron a texto sin promesas inventadas.

### 2026-08-07 · El sistema de avisos, reescrito: «avisado» deja de ser un evento y pasa a ser un estado

**La autopsia que lo motivó.** Se preguntó algo simple —«si entra un lead a llamado
pendiente, ¿se le notifica a Luis?»— y la respuesta fue: sólo si lo crea el bot, sólo entre
las 9 y las 20, y sólo si nada falla. Medido en la base real: de 5 tickets vivos, **4 eran
`Origen=Manual` y ninguno disparó jamás un aviso**. Los 4 leads del puente provisorio
estuvieron varados 10 días y hubo que rescatarlos a mano llamando a `/api/mc-aviso`.

**La decisión de arquitectura: el sello es el estado.** «¿Alguien del equipo se enteró de
este ticket?» dejó de vivir dentro del JSON que devuelve un endpoint —y que nadie lee— para
vivir en Airtable: **`Aviso equipo enviado`**. Vacío = nadie se enteró. Ese vacío es a la vez
la cola del briefing, el filtro del barrido y la condición de reintento, sin escribir un
condicional extra. La regla que ordena todo: **nunca franja sin red** — ningún punto de envío
recibe la guarda horaria si no tiene además sello y barrido que lo recuperen.

**Una sola regla de horario en todo el sistema: franja 9–20, todos los días, todos los
destinatarios** (decisión de Gabriel). Se eliminaron **6 copias de `horarioOk`** repartidas en
`functions/api/`, **en dos dialectos incompatibles** cuyos defaults ya no coincidían (en el
viejo, Luis SÍ recibía los martes), más una séptima ventana hardcodeada en `cron-reenganche`.
🔴 **Mina desactivada:** las 3 copias del dialecto viejo parseaban `:(\d)-(\d)@…`; si
`AVISO_HORARIOS` se hubiera seteado alguna vez con el formato **documentado** (el de dígitos),
el regex no habría calzado, habrían caído en `if (!m) return true` y esos endpoints habrían
avisado **24/7 en silencio**. Nunca se pisó sólo porque la env jamás se seteó.

🔴 **Bug de tormenta cazado por los tres críticos adversariales, de forma independiente.** En
`mc-llamado` y `cron-sourcing` el `try/catch` envolvía el **bucle entero de destinatarios**:
si el segundo sid fallaba, el primero —que ya había recibido— se contaba como fallido y no se
sellaba. Sin reintentos era inofensivo; **con el barrido nuevo habría reenviado a Luis y
Roberto cada 15 minutos, para siempre**, y el disparador más probable era justo lo que se iba
a hacer: agregar un sid nuevo copiado a mano. Ahora el `try` va **por destinatario** y se
sella si `enviados > 0`.

**Piezas nuevas:** `lib/avisos.js` (único dueño de horario, destinatarios y envío) ·
`functions/api/cron-avisos.js` (barrido cada 15 min sobre `Llamados` + `Solicitudes` +
`Consignaciones`, con gracia de madurez de 10 min para no avisar la fila vacía que Luis acaba
de crear con el «+», tope de 10 por corrida y freno de 3 intentos) ·
`functions/api/mc-rellamar.js` (el botón «Sí, llámenme» de `llamada_no_contestada_v2`).

**Airtable:** 9 campos nuevos (`Aviso equipo enviado` + `Intentos aviso` en las tres colas;
`Pidió rellamada`, `Reaperturas`, `_salida_desde` en `Llamados`) y **backfill de los 5
registros existentes** — sin él, el primer barrido habría re-avisado tickets que Luis escribió
él mismo.

🔴 **Métrica rota descubierta y corregida:** `Espera (min)` y `Fecha primera llamada` quedaban
**vacíos para siempre** en todo ticket marcado «No contestado», porque el sello colgaba de
`Estado` y esa salida devuelve el Estado a «Llamada pendiente» a propósito. Experimento natural
en los datos del 06-ago: Ayala y Briceño («Sin interés» → Cerrada) tienen sello; Springmüller
(«No contestado») no, pese a que Luis lo llamó a las 18:41. O sea que **todo lead al que se
llamó y no contestó figuraba como nunca llamado**. Campo nuevo `_salida_desde`
(`LAST_MODIFIED_TIME({Salida})`) para colgarlo de `Salida`, que sí cambia siempre.

**El borde de las 9:00, determinista:** `cron-avisos` arranca con
`if (esTickBriefing()) return`. El briefing lista y sella toda la cola de la noche; el barrido
no toca nada. La guarda **no depende del orden del worker** —a propósito, porque ese orden es
fácil de romper al editar el array— aunque el worker igual se reordenó para que el briefing
corra primero (su ventana es de un solo tick al día).

**Verificado:** el bundler de Pages **sí resuelve imports fuera de `functions/`** (probe real
compilado y borrado; bundle de 202 KB con `lib/` dentro) — era el único riesgo estructural del
diseño. `test/avisos-horario.mjs` se **borró**: su premisa era falsa (decía cazar la
divergencia y comparaba justo las dos copias idénticas). Lo reemplaza
`test/guardas-avisos.mjs`, que falla si reaparece cualquiera de los errores de arriba.
`test/salida-llamado.mjs` se convirtió a `import` real: con `readFileSync`+`new Function`
habría reventado con `SyntaxError` al primer `import` y, por ir primero en la cadena `&&`,
se habría llevado los otros 8 suites en silencio.

**Tests: 9 suites, 133 aserciones + 7 guardas, todo verde.** Incluye los bordes de franja en
**enero y julio** (Chile pasa a UTC-3 el primer sábado de septiembre) y la invariante de que
`mc-rellamar` **jamás hace POST a la colección `Llamados`** en ninguna de sus 7 ramas.

### 2026-08-06 · Auditoría de cierre P1/P2: un duplicado cazado, la huérfana apagada y el catch-all descubierto

**Auditoría completa de las dos puertas** (repo + Airtable + backend + ManyChat en pantalla)
para responder «qué falta para cerrar». Lo que apareció:

**🔴 Dos automatizaciones LIVE sobre el mismo reel — cazado y corregido.** El post
`Dad9A_zJy0D` (Levo SL2) **ya tenía su flujo desde el 30-jul**, pero bautizado con el nombre
de otra bici: «Levo SL S-Works 6/07/2026». Como el nombre no lo delataba, el 05-ago se le
montó un segundo flujo encima. Verificado por dos vías independientes: misma imagen de post
(`734973701_1704280974032621_…`) y mismo `"reel": "Dad9A_zJy0D"` en el body de `mc-evento`.
Con 7 de 10 keywords solapadas, un comentario «precio» habría mandado **dos DMs y duplicado
los registros**. No alcanzó a dispararse (0 ejecuciones). **El duplicado quedó borrado**
(papelera de ManyChat, restaurable) y la original se renombró a «Levo SL2 S-Works 6/07/2026».
Además se le reemplazaron las **respuestas públicas de fábrica** —una con falta de ortografía
visible en el comentario público, «¡Inofrmación enviada!»— por las 5 rotadas del estándar.
→ Runbook §4 reescrito con el mapa real y la lección: *el nombre no es evidencia; verificar
el `reel` del body y la imagen del disparador antes de duplicar*.

**Automatización huérfana «Tarmac S-Works SL6» APAGADA.** Estaba LIVE sobre el post
`DawQ95EO5mn` sin bici en Airtable (la única Tarmac es una SL7 vendida): los `cf_bici_*`
llegaban vacíos, B2 no se armaba y el lead quedaba colgado a mitad del flujo.

**Descubierto: el catch-all any-word del quiz está ACTIVO y es enorme.** «Plantilla reel sin
bici específica» tiene **~75 disparadores** «Publicación o Reel específico + cualquier
comentario» (#20 a #95, todos ON salvo el #20). Si alguno pisa uno de los 4 reels con ficha
propia, ese comentario dispara dos flujos. **No se resolvió por inspección** (75 posts) —
lo resuelve la prueba del doble disparo con cuenta virgen que el diseño ya exigía.

**Hallazgo de cobertura: el reel `DZ1O3ViO2Qz` (Levo 4G) no tiene automatización propia.**
Los flujos por-reel LIVE son 4, no 6 como decía el runbook.

**Airtable:** borrado el ticket de prueba «test» que estaba en la cola de Luis
(`rec9kUvpajach4zfw`) — la cola queda con 4 leads reales, todos aún sin llamar.
**`Atiende` expuesto y publicado** en el Kanban de Llamadas (8 campos visibles). Verificado
que ya estaban hechos dos pendientes que los docs daban por abiertos: `Franja` oculta en la
pantalla 2 y `Bicis para la visita` en los `watchFields` de «kanban a mensajes» (3 campos).
⚠️ Los campos vacíos no se renderizan en las tarjetas del Kanban, así que para que Luis
**escriba** `Atiende` hay que activar el panel de detalle del registro — queda a decisión de
Gabriel porque cambia su flujo diario.

**Tests:** `mc-clasifica.mjs` (45/45) y `mc-match-quiz.mjs` (10/10) estaban fuera de
`npm test` — el enrutador de toda la puerta DM sin cobertura en CI. Agregados al script.

### 2026-08-05 (PM) · Cierre del embudo: cadena de confirmación E2E, 5 salidas ahumadas, copys al estándar y el 6º reel LIVE

**La cadena de confirmación quedó verificada punta a punta con WhatsApp real:** Gabriel
agregó el `subscriber_id` que faltaba en la puerta DM y la corrida completa funcionó —
fecha puesta en pantalla 2 → tarjeta pasa a «Agendada» → confirmación por WhatsApp →
botón «Sí, confirmo» → `mc-evento` (`soloEstado`) → lead `visita_confirmada` → tarjeta
«Confirmada». El eslabón que faltó en la prueba anterior no era el botón: era la
automatización de pantalla 2, creada después de su prueba.

**Humo de las 5 salidas de llamada con mensajes reales** (primera vez todas): confirmación
de visita, encargo (crea Solicitud + aviso al staff), región (`region_gestionando` +
Estado despacho), no contestado (vuelve a cola con sello), sin interés (cierra mudo).
`aviso_equipo` publicado por Gabriel + env `FLOW_NS_AVISO_EQUIPO` + redeploy → probado
en vivo. **4 tickets de rescate** creados para los leads perdidos del puente provisorio
(Concha, Springmüller, Ayala, Briceño) con aviso WhatsApp a Luis y Roberto vía `mc-aviso`,
registrados en `Avisos` con link al lead (el rollup dirá si terminaron en venta).

**Pasada de copys ejecutada** (`docs/V2_PASADA_COPYS.md`): el B3 nuevo («mejor que te
llame Luis 📞 Él inspeccionó personalmente cada bici…») quedó pegado y publicado en las
4 automatizaciones de comentarios + el quiz; C-2 de CONTACTO acortado en la puerta DM
(B4 ya pide el número); verificado que el guard viejo C2 no sigue conectado en ninguna.
Plantillas Meta intocadas. Además: `docs/V2_SISTEMA_COMPLETO.md` (el sistema punta a
punta en un solo doc) y 4 correcciones a la guía HTML del equipo.

**El 6º reel quedó LIVE — duplicado «Levo SL2 S-Works»** (Claude vía Chrome, patrón
runbook §4): trigger sobre el post `Dad9A_zJy0D` (verificado por fecha 2026-07-06 contra
la fila `Reels`), 10 keywords, 5 respuestas públicas rotadas, `reel` corregido en
`mc-evento` y `mc-llamado`, URL «Ver Ficha» ×2 → `/ficha/levo-sl2-s-works-s4` (curl 200).
El B3 nuevo venía de fábrica (el master ya lo tenía publicado). **Pendiente: humo con
cuenta ajena al equipo.** Ojo descubierto en el camino: quedó una automatización LIVE
vieja «Tarmac S-Works SL6» sin bici en Airtable, y el quiz publicado incluía un borrador
previo de Gabriel (que ya era el B3 — sin efecto adverso).

### 2026-08-05 · La confirmación de visita, auditada en vivo: un bug cazado y el flujo Pendiente→Agendada

**Bug real cazado probando la cadena completa:** la puerta de DM **no manda `subscriber_id`**
en el body de `mc-llamado` (etapa A2+SE3) — el as-built lo omitía. Consecuencia medida en
producción: el lead queda sin `MC subscriber id` y `salida-llamado` responde
`sin_subscriber_id` → **ningún mensaje de salida (confirmación incluida) le llega a un lead
de DM**. El doc ya está corregido; falta la línea en ManyChat (`"subscriber_id":
"<ID de contacto>"`, mismo patrón que comentarios). La prueba en vivo confirmó de paso que
el resto de la cadena SÍ funciona: fecha puesta → automatización → endpoint → visita copiada
al lead + `visita_agendada`, y que `MANYCHAT_TOKEN`/`FLOW_NS_CONFIRMACION` están seteadas.

**Idempotencia SOLO del mensaje** (`salida-llamado.js`): el sello cortaba TODO, así que las
bicis elegidas después de poner la fecha nunca llegaban a `MC bici`, y un **reagendo por
teléfono** dejaba los recordatorios corriendo sobre la fecha vieja. Ahora los datos del lead
se refrescan siempre (el WhatsApp sigue saliendo una sola vez) y los sellos de recordatorio
solo se limpian si la fecha CAMBIÓ — refrescar bicis no re-arma un recordatorio ya enviado.
Tests 53/53 (`test/salida-llamado.mjs`, casos 17–19-bis nuevos).

**Flujo Pendiente→Agendada en pantalla 2 (diseño de Gabriel):** opción nueva `Pendiente` en
`Estado visita` (primera columna); la tarjeta que llega de «Visita agendada» entra ahí, y al
completarle «Fecha y hora de visita» la automatización nueva **«Visitas: fecha puesta →
Agendada»** (`wflzIYgsDfNxUacnW`) la mueve sola — el mismo gesto que dispara la confirmación.
La automatización vieja quedó reescrita para escribir `Pendiente`. Ambas esperan
activación/aplicación en la UI. Pendiente manual: agregar `Bicis para la visita` a los
`watchFields` de «kanban a mensajes» (la API no edita automatizaciones con script — reconfirmado).

**Limpieza y verdad de métricas:** borrados los registros de prueba del 04-08 (3 leads DM,
3 tickets de Llamados incl. los ensayos de @_.matamala, 1 Solicitud, 1 Consignación, 2 Avisos);
Intereses #278/#279 marcados DEMO (estaban contando como reales). `nuevo_llamado` reconfirmado
funcionando (env `FLOW_NS_LLAMADO`); `aviso_equipo` con envoltorio creado por Gabriel (falta
publicar + env `FLOW_NS_AVISO_EQUIPO` + redeploy).

### 2026-08-03/04 · Puerta de DM CONSTRUIDA (las 8 etapas) — y el enrutador se mudó a backend propio

**El ítem 3 del plan de cierre quedó montado completo en ManyChat** (Gabriel, guiado
etapa por etapa con `docs/V2_CONSTRUCCION_DM.md`): entrada E-0..E-4 (cualquier DM +
respuesta a historia), cascada de 12 condiciones R-1..R-12 con rama else, las 12 rutas,
anti-bucle y rama de adjuntos. Primeras corridas reales verificadas contra Airtable:
**VENDER end-to-end** (captura de 4 datos → Consignaciones → teléfono → ticket con nota
`VENDE: Kenevo expert…`) y **anti-bucle** («qué libros venden» → aviso + registro).

**La decisión grande: el AI Step de ManyChat quedó DESCARTADO como enrutador.** En las
pruebas respondía «Dame un segundo 👀» y moría en **0 % finalizado**: es un agente
conversacional que solo avanza al siguiente paso cuando "decide" que cumplió su objetivo,
y con un objetivo de clasificación muda espera mensajes para siempre — sin guardar
`cf_intencion`, sin avanzar, sin error (bug conocido de la comunidad de ManyChat; el
reprompt con orden de término explícita tampoco funcionó). → **`/api/mc-clasifica`**:
el enrutador es ahora una Solicitud externa (avanza garantizado) con reglas deterministas
que implementan las 12 rutas y sus precedencias (CONTACTO gana a todo · la pregunta le
gana al gracias · precio sin modelo = BICI_SUELTA · diccionario de modelos con typos:
«quenevo»→Kenevo, «swork»→S-Works). **45/45 tests offline** (`test/mc-clasifica.mjs`).
Trae una capa de IA **dormida** (Workers AI; se activa con el binding `AI` en Pages +
redeploy) — sin ella, lo ambiguo cae honesto en `NO_CLASIFICA` → anti-bucle → humano.
Antes de eso el mismo límite obligó a reempaquetar los prompts (el campo «objetivo» real
acepta 500 caracteres → versión corta + contexto ampliado), que quedó como referencia en
el runbook §5.2.

**Aviso a humanos con métrica de conversión (pedidos de Gabriel):**
- **`/api/mc-aviso`** — cada «Notificar a administradores» del bot (AB-2 del anti-bucle,
  T-2 de TECNICA) ahora además manda un WhatsApp real al equipo con la plantilla genérica
  **`aviso_equipo`** (🟡 esperando aprobación de Meta; mientras tanto `no_configurado`,
  sin romper nada). **Sin filtro de horario a propósito**: lead varado > silencio.
- **Tabla `Avisos` en Airtable** — el endpoint registra cada aviso (resumen, handle,
  motivo, mensaje, si el WhatsApp salió) con **link al Lead** y un rollup **«Terminó en
  venta»** que sigue `Llegó a cerró`: total de avisos = filas, conversión = filas en 1.
  100 % backend, cero trabajo del staff. Verificado con el caso real de «los libros».
- Etapa 7 rediseñada según lo pidió Gabriel: **sin menú de rescate y sin contador de
  golpes** — NO_CLASIFICA deriva directo a humano («Espérame un poco 🙌…»), modo humano
  24 h con retorno automático. `cf_no_reconocido` quedó sin uso.

**Bugs cazados probando con cuentas reales (2026-08-04), ninguno con error visible:**
1. **Cable suelto A-2(2º)→A-3**: la ruta MODELO (54 % del tráfico) moría en silencio tras
   borrar campos — «tienen la levo comp carbon» creaba el Lead y nada más. El backend
   estaba perfecto (verificado offline: «Levo» → match Levo SL2 S-Works + otras).
2. **«qué tienen en el catálogo» → NO_CLASIFICA**: regla nueva en `mc-clasifica` — el
   browsing va a ASESORIA (el quiz recomienda).
3. **El copy de GARANTIA decía recompra a 18 meses y son 12** (corrección de Gabriel).

**As-built del canvas** (equivalencias, tabla completa al inicio del doc de construcción):
E-2 detecta adjuntos con **«Last Reply Type es text»** (hallazgo de Gabriel, mejor que
mirar Last Text Input: no arrastra texto viejo) · A-3 con la condición invertida («es
desconocido») · V-1..V-4 en un solo bloque de 4 esperas · SE-CLASIFICA = «Acciones #4» ·
B3 = «D3». **Los textos del AI Step del runbook §5.2 sobreviven como base del prompt de
la capa IA de `mc-clasifica`.**

**Además:** protocolo E2E actualizado a 13 pruebas (una por ruta + adjuntos + baja) ·
las 4 verificaciones de pantalla bajaron a 2 (las del AI Step murieron con él) ·
`Franja` quedó como campo legado (el bot V2 no la pregunta): ocultarla de la pantalla 2
y agregar **«Fecha y hora de visita»** al panel — es EL campo que dispara la confirmación
de visita (pendiente en la interfaz).

### 2026-07-30 (tarde) · Quiz construido + 6 bugs cazados probando con tráfico real
**Ítems 1 y 2 del plan de cierre quedaron operativos.** El quiz de reels sin bici se montó
en ManyChat (as-built: **una sola automatización** con triggers de varios posts en any-word,
las 3 preguntas en un bloque único, ficha SOLO TEXTO con el link como gancho, **sin `reel`**
— se acepta perder la atribución por video en estos posts) y se verificó E2E contra Airtable:
Lead + `Cuestionario iniciado` + Interés `Match` con `Crit·*` + ticket con la bici del hero
y el brief + `Fecha teléfono`.

**Los 6 bugs, todos cazados en pruebas reales del mismo día (ninguno daba error visible):**
1. **El trigger de «kanban a mensajes» no re-disparaba.** Era *record matches conditions ·
   Salida no vacía*, que solo dispara en la transición vacío→valor; como «Salida vacía →
   Llamada pendiente» llena el campo al nacer el ticket, **ningún arrastre posterior del
   Kanban ejecutaba `salida-llamado`** (ni mensajes, ni Solicitudes, ni Estado). → Ahora es
   **record updated observando `Salida` + `Fecha y hora de visita`** (el segundo campo es el
   que dispara la confirmación de visita al completar la fecha).
2. **ManyChat no guarda booleanos en campos de texto.** `match` y `biciDisponible` viajaban
   como booleano JSON → `cf_match` quedaba vacío → C-Q mostraba el no-match honesto AUNQUE
   hubiera hero (y la rama C1a de bici vendida en comentarios nunca habría disparado). → Los
   endpoints emiten **la palabra** `"true"`/`"false"`.
3. **«3,5 millones» se parseaba como $35.000.000** (pelaba el punto antes de multiplicar) →
   el quiz recomendaba la bici más cara de un techo ×10. → `parsePresupuesto` captura el
   decimal primero y acepta números cortos a secas («3,5» · «10») como millones.
4. **El quiz guarda el TEXTO del botón** («MTB / cerro», «Ciudad»), no el literal del select
   → 2 de 3 opciones perdían los 40 pts de disciplina. → `parseDisciplina` canonicaliza, y
   pedir OTRA disciplina ahora **resta** (antes presupuesto+estatura solos pasaban el umbral
   y se recomendaba una MTB a quien pidió ciudad).
5. **Modo B sin umbral** (recomendaba siempre) → umbral del 35 % del puntaje alcanzable con
   los criterios entregados (quiz completo ≈ 25) + `mc-match` acepta `reel` para atribuir el
   Interés al video. Tests offline: `test/mc-match-quiz.mjs` (18 aserciones).
6. **C2 (guard anti-duplicado) estaba cableado al revés** en ManyChat: la rama «ya recibió
   oferta» iba a A1→B3 y la rama del lead nuevo moría sin destino.

**Operación (ítem 1):** interfaz «Operación Llamadas (V2)» afinada — `Notas` fuera de la
pantalla 1, `No contestado` antes de `Sin interés` en el select, **«Haz clic en los detalles
del registro» activado en Visitas y Región** (sin eso Luis no podía editar nada), y
**formulario «➕ Nuevo llamado»** publicado (walk-in/llamado directo; `Origen` con default
`Manual` a nivel de tabla — seguro porque el bot escribe `Bot DM` explícito). El ticket real
de `@carlosbriceno._` (26-jul) estaba varado «Sin categorizar» y se rescató a la cola.
**Plantillas aprobadas por Meta:** `region_gestionando` quedó **sin variable** (texto fijo —
no editarla: vuelve a revisión) y `llamada_no_contestada` fue **recategorizada a Marketing**
por Meta (funciona igual; cuesta más por conversación). Envs `FLOW_NS_REGION` y
`FLOW_NS_NO_CONTESTA` seteadas y desplegadas. Aviso `nuevo_llamado` a Luis **verificado en
su chat**. ⚠️ Tickets manuales (sin Lead) **no despachan mensajes ni crean Solicitudes**
(`sin_lead` por diseño): el walk-in que busca algo se registra con el form «Nueva solicitud».

**Documentos nuevos:** `docs/V2_CONSTRUCCION_QUIZ.md` + `docs/embudo_quiz_v2_bloques.svg` ·
`docs/V2_CONSTRUCCION_DM.md` + `docs/embudo_dm_v2_bloques.svg` · `docs/V2_GUIA_ROLES.md`
(1 página Luis + 1 dueños). **Lección operativa:** se subió un reel sin aviso y 3
comentaristas se perdieron (sin automatización no hay respuesta privada, y no son contactos
→ irrecuperables) — **ningún reel se publica sin su automatización activa**.

### 2026-07-27 · El pivote
**Qué cambió:** el objetivo del bot deja de ser la visita y pasa a ser **el teléfono**. El bot
entrega valor (ficha con puntaje, estado honesto y ahorro), pide el número, y **la visita la
cierra Luis por teléfono**.

**Por qué:** la semana 30 fue la primera con tráfico real y el resultado fue **31 leads, 27
fichas entregadas y CERO visitas agendadas**. La evidencia externa explica por qué: un flujo
tipo formulario convierte ~1,7 %, una llamada ~37 %; en vehículos usados el 78 % de los leads
telefónicos agenda cita contra el 44 % de los digitales. El cuello no era el copy: era que
nadie pasaba a voz.

**Decisiones tomadas (no re-discutir):**
- **Sin menú de bienvenida.** El bot reconoce la intención del texto libre y rutea. La IA de
  intención de ManyChat está confirmada disponible.
- **Sin pregunta de ubicación en el bot.** Es irrelevante si igual va a hablar con el
  especialista; Luis pregunta la comuna en la llamada, que da mejor dato.
- **10 palabras clave por reel** (NO any-word). Se asume perder la cola larga a cambio de que
  el filtro deje pasar solo intención declarada.
- **El permiso de WhatsApp lo marca Luis en la llamada**, no el bot. El teléfono se pidió para
  una llamada; usarlo para mensajes sin permiso explícito es consentimiento de canal A en canal B.
- **El bot no retoma dentro de las 24 h** cuando pasó a modo humano, aunque entienda la
  intención: no se pisa una conversación de Luis en curso.
- **Meta del dueño: 20–30 % de los leads entregan teléfono** (semana 30 = 3 %).
  **La semana 30 es la base de comparación.**

**Aprobado por:** Roberto (reunión 2026-07-27). Alfonso informado.

### 2026-07-27 · La operación de Luis: un Kanban, un gesto
Luis trabaja en **una sola pantalla**: arrastrar la tarjeta *es* marcar la salida *es*
disparar el mensaje automático. Cinco salidas desde una cola única.
Diseño: [`docs/V2_OPERACION_KANBAN.md`](docs/V2_OPERACION_KANBAN.md).

### 2026-07-27 · Construido
- `mc-evento` devuelve la bici en **campos planos** (puntaje, área más baja, estado honesto,
  precio/ahorro, rango altura, batería, disponible) — sin esto el DM no puede pintar la ficha.
- `mc-llamado` sella **`Fecha teléfono`** en el Lead (la métrica #1) y **deduplica** tickets
  abiertos del mismo lead.
- **`salida-llamado`** (nuevo): el motor de post-llamada. Propaga el permiso del ticket al
  Lead, copia la visita agendada por teléfono, dispara la plantilla que corresponde, con sello
  de idempotencia. 17/17 en pruebas.
- **`cron-sourcing`** (nuevo): avisa a Roberto y Alfonso los encargos que pasan a `Buscando`.
  Es un barrido del cron existente, **no una automatización de Airtable** (esas se pagan).
- Tablero: etapa **«Dejó teléfono»** en el embudo, y las conversiones separadas
  «Ficha → Teléfono» (mide al bot) y «Teléfono → Agenda» (mide la llamada).
- **`mc-match` modo A**: matching por bigramas. Caso real corregido: «Levo sl swork» daba
  no-match teniendo la bici disponible.

### 2026-07-27 · Datos
- **Limpieza:** 17 registros de prueba eliminados. La base quedó 100 % real.
- **Atribución de reels al 100 %:** los 13 Intereses huérfanos se recuperaron leyendo los
  comentarios públicos de cada post en Instagram. **Esa es la única fuente retroactiva** — ni
  Airtable ni el export de IG guardan de qué post vino un comentario.
- 6 reels registrados en `Reels`. El `Post ID` es el **shortcode** de la URL.

---

## V1 · El sistema que capta y agenda — EN VIVO (jun–jul 2026)

### 2026-07-20 · Ailoo pasa a ser el ERP central
El embudo se corta en **show/no-show**; la venta la registrará Ailoo vía integración futura
(contacto: «Gina»). Trazabilidad por teléfono del comprador + código único por unidad (SWSS).
`registrar-venta` queda como **fallback transitorio**, no como camino principal.

### 2026-07-17 · Tablero de reporte (Anexo A3)
App web privada **separada** (repo `biketrust-tablero`): 19 métricas calculadas en build time
desde esta base, gate server-side con cookie HMAC. Solo lectura.

### 2026-07-10 · Lanzamiento
El embudo completo sale a producción: Puerta 1 (comentario → ficha), Puerta 2 (DM → router,
quiz, encargos, consignación), región, WhatsApp con confirmación y recordatorios, avisos al
staff. **La semana 30 (20–26 jul) es la primera con tráfico real.**

### 2026-07-09 · Candado y sourcing
`MC_KEY` activa en los 7 puentes. Tablas `Solicitudes` y `Llamados` operativas. Briefing
diario al staff en vivo.

### 2026-07-01 al 07-08 · El embudo
`mc-lead` · `mc-evento` · `mc-agenda` · `mc-match` · `mc-consigna` · `mc-waitlist` ·
`mc-llamado`. **Rediseño del 07-01:** el embudo se automatiza de punta a punta hasta el
showroom; el humano solo cierra en tienda. *(Esta decisión fue parcialmente revertida el
2026-07-27: el humano vuelve al embudo, pero en la llamada, no en el chat — ver V2.)*

### 2026-06-21 · Sitio en vivo
Sitio estático generado desde Airtable a Cloudflare Pages. Catálogo, fichas, reservas.

---

## Decisiones revertidas (y por qué)

| Decisión original | Qué la revirtió |
|---|---|
| «El humano solo cierra en tienda; el embudo es 100 % automático» (07-01) | La semana 30: 27 fichas → 0 agendas. El humano vuelve, pero en la llamada. |
| «Menú de 3 botones en el DM» (07-07) | 5 DMs libres quedaron varados sin ruta. Se reemplaza por reconocimiento de intención. |
| «¿Estás en Santiago?» como filtro del bot | Es irrelevante si igual va a hablar con el especialista, y convierte peor que una invitación. |
| «Registrar la venta en Airtable» como camino principal | Decisión Ailoo (07-20): la venta la registra el ERP. |

### 2026-07-27 · Auditoría de lectura en frío
Tres lectores independientes leyeron los repos **sin contexto previo** para verificar que se
entienden solos. Encontraron **tres bugs reales**, ya corregidos:

1. **`MC_TOKEN` vs `MANYCHAT_TOKEN`** — `salida-llamado` y `cron-sourcing` leían una variable
   de entorno que **no existe en Cloudflare**; las otras 8 funciones usan `MANYCHAT_TOKEN`.
   Habrían reportado «no configurado» para siempre, en silencio.
2. **`No contestó` vs `No contestado`** — el código hace match exacto contra el nombre de la
   opción del select. Los documentos usaban una grafía y el código otra: al arrastrar la
   tarjeta no habría disparado nada. **Unificado en `No contestado`.**
3. **`salida-llamado` no sincronizaba `Estado`** aunque el diseño lo prometía. Sin eso, el
   sello de `Fecha primera llamada` (la métrica de velocidad) nunca se disparaba.

También: el README no guiaba (mandaba a la documentación en retiro antes que al CHANGELOG),
las rutas locales estaban mal, había una referencia a un archivo inexistente, y `CLAUDE.md`
tenía **dos «FOCO ACTUAL» contradictorios**. Todo corregido.

**Los tests ahora viven en el repo** (`test/`, `npm test`): antes el CHANGELOG citaba «17/17»
y los scripts no estaban versionados, así que nadie podía re-correrlos. Son 23 aserciones que
corren sin tocar Airtable ni producción.

## Erratas de documentación corregidas

- El API de Airtable **sí crea lookups y campos de fórmula** (`CLAUDE.md` §5.2 decía que no).
  Lo que **no** puede es agregar opciones a un select existente ni borrar campos.
- Publicar un reel **NO reabre** la ventana de 24 h de Instagram. Solo la reabre un mensaje
  de la persona. (Se había asumido lo contrario al planificar el reenganche.)
