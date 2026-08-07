# Bike Trust · Historial del sistema

> **Para quien lee esto en frío (humano o Claude):** este archivo cuenta *qué pasó y por qué*,
> en orden. Si vienes llegando, léelo antes que cualquier otra cosa: explica por qué el
> sistema está como está y qué decisiones ya se tomaron (para no volver a discutirlas).
>
> El estado **actual** vive en [`CLAUDE.md`](CLAUDE.md). Este archivo es la memoria histórica.

---

## V2 · El embudo que apunta a la llamada — EN CONSTRUCCIÓN (desde 2026-07-27)

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
