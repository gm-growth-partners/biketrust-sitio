# Hoja de construcción — Puerta de DM V2 (AI Step enrutador)

> **Qué es esto.** El detalle ejecutable de la puerta de DM, en orden de construcción
> (del final hacia el principio). El diseño y el porqué viven en
> [`V2_RUNBOOK_MANYCHAT.md`](V2_RUNBOOK_MANYCHAT.md) §5 — **los textos del AI Step se
> copian TAL CUAL de §5.2** (no los duplico acá para que exista una sola versión).
> El mapa visual es [`embudo_dm_v2_bloques.svg`](embudo_dm_v2_bloques.svg).
>
> **Es UNA automatización, no se duplica.** Los bloques con el mismo nombre que en las
> hojas de comentarios/quiz se construyen IGUAL que allá (mismo copy, mismos botones);
> acá solo se listan sus diferencias.
>
> Decisiones ya tomadas que esta hoja aplica: AI Step **clasifica y extrae, nunca
> responde** · `ASESORIA` → **quiz** (2026-07-30, umbral desplegado) · `mc-consigna`
> ANTES del teléfono · un solo ticket (`Llamados`) · quiz de 3 preguntas.

Reglas transversales: botones «Ir a un paso», nunca URL · `<Nombre de usuario>` desde el
selector · `?key=<MC_KEY>` en TODAS las solicitudes externas · mapeos con rutas planas.

---

## Etapa 1 · Convergencia y cierre — los 12 bloques, en orden de construcción

> Del final hacia atrás, para que cada cable encuentre su destino ya creado. Todos los
> mensajes son del canal Instagram. Botones siempre «Ir a un paso», nunca URL.

### 1 · B7 · Salida blanda — Mensaje, sin botones, sin siguiente paso
```
Dale, sin problema 👌 Cero llamadas.

Cualquier duda me escribes por acá. Y si alguien la aparta antes, te aviso.
```

### 2 · B6 · Confirmación — Mensaje, sin botones, sin siguiente paso
```
Listo ✅ Te va a llamar Luis Sulbarán, nuestro especialista, {{cf_promesa}}.

Te marca desde el +56 9 2181 5855 — guarda el número así sabes que somos nosotros 😉

Si no te pilla, te deja un WhatsApp a ese mismo número.
```
- El número va **tipeado tal cual** (no es variable). `{{cf_promesa}}` desde el selector.
- La última línea **no se saca**: declara el permiso del ciclo «No contestado».

### 3 · B6-D · Confirmación dedup — Mensaje, sin botones, sin siguiente paso
```
Listo ✅ Ya tenía tu solicitud anotada — Luis te llama en cuanto pueda.

Te marca desde el +56 9 2181 5855 — guarda el número así sabes que somos nosotros 😉

Si no te pilla, te deja un WhatsApp a ese mismo número.
```

### 4 · C3 · ¿Hubo promesa? — Condición
- `cf_promesa` **tiene algún valor** → **B6** · Si no → **B6-D**.
- *Por qué: si el lead ya tenía ticket abierto, `mc-llamado` responde `dedup` SIN
  `promesaLlamada` → el campo queda vacío (A2 lo borró antes) → B6 saldría con el hueco.*

### 5 · A2+SE3 · El backend — Acción + Solicitud externa, en secuencia
1. **Acción → Borrar valor** de `cf_promesa`.
2. **Solicitud externa** — POST · `Content-Type: application/json`
```
https://biketrust-sitio.pages.dev/api/mc-llamado?key=<MC_KEY>
```
```json
{
  "handle": "<Nombre de usuario>",
  "telefono": "{{cf_telefono}}",
  "bici": "{{cf_hero_bici}}",
  "notas": "Puerta 2 {{cf_modelo_texto}} · dijo: {{cf_mensaje}}"
}
```
   - `<Nombre de usuario>` = campo de sistema de Instagram **desde el selector**.
   - `<MC_KEY>` = la llave vigente (la del script de «kanban a mensajes»), NO la V2.
   - **Sin** `reel` · `ciudad` · `franja` · `optin`. `bici` vacío si la ruta no pasó por
     match → ticket sin brief, correcto.
   - **Mapeo de respuesta:** `$.promesaLlamada` → `cf_promesa`.
3. Siguiente paso → **C3**.

### 6 · B4 · El teléfono — Entrada de usuario
- Pregunta:
```
Perfecto 🙌 ¿A qué número te llamamos?

Escríbelo como quieras (9 1234 5678, +569…, da lo mismo).
```
- Tipo de respuesta: **Teléfono** → guardar en `cf_telefono` · ✅ **«Guardar como ID de
  WhatsApp»** (lo necesita el motor de recordatorios).
- Mensaje de reintento (el paso no permite ramas de fallo, solo este texto):
```
Creo que se cortó un dígito 🙈 ¿me lo mandas de nuevo? Así sirve: 9 1234 5678
```
- Respuesta válida → **B5** *(cable diferido: se conecta al crear B5 en el paso 7)*.

### 7 · B5 · El eco — Mensaje
```
Anotado: {{cf_telefono}} ✅
```
| Botón | Destino |
|---|---|
| `Correcto` | → **A2+SE3** |
| `Corregir` | → **B4** |
*(Ahora volver a B4 y conectar su respuesta válida → B5. Único cable mutuo del montaje.)*

### 8 · B3 · La oferta de llamada — Mensaje (copy nuevo 2026-07-30)
```
Oye, mejor que te llame Luis 📞 Él inspeccionó personalmente cada bici que tenemos — nadie te va a responder más derecho.

En 5 minutos te dice cuál te calza según tu estatura, qué hay dentro de tu presupuesto, y si quieres te la aparta mientras decides.
```
| Botón | Destino |
|---|---|
| `Sí, que me llamen` | → **B4** |
| `Por ahora no` | → **B7** |

### 9 · A1 · Marcar oferta — Acción
- Set custom field → `cf_oferta_enviada` = `si` (texto, sin tilde) → siguiente: **B3**.

### 10 · D1 · Smart Delay — 40 segundos
- Al vencer → **A1**. *(Sin C2: directo — el guard se eliminó 2026-07-30.)*

### 11 · C-OFERTA · La guarda de segunda vuelta — Condición
- `cf_oferta_enviada` **es igual a** `si` → **B4** *(ya recibió la oferta: se le pide el
  número directo, sin repetir el discurso — acorta, nunca corta)*.
- Si no → **D1**.

### 12 · B2-C · Catálogo — Mensaje, sin botones
```
Acá puedes ver todo lo que tenemos disponible ahora mismo 👉 https://biketrust.cl

Todas pasaron por nuestra inspección, con su nota de 1 a 7 a la vista.
```
- Salida → **C-OFERTA**.

### Checklist de cables de la Etapa 1
```
B2-C → C-OFERTA
C-OFERTA  sí → B4 · no → D1
D1 → A1 → B3
B3  «Sí, que me llamen» → B4 · «Por ahora no» → B7
B4  válido → B5 (reintento interno, sin rama de fallo)
B5  «Correcto» → A2+SE3 · «Corregir» → B4
A2+SE3 → C3
C3  con valor → B6 · vacío → B6-D
```

**Las `notas` de SE3 cambian POR RUTA** vía el portador `cf_modelo_texto`
(sin esto, un reclamo de postventa entra al Kanban idéntico a un lead de compra):

| Ruta que llega al teléfono | `"notas"` en el body |
|---|---|
| MODELO / BICI_SUELTA | `Puerta 2 · dijo: {{cf_mensaje}}` |
| Quiz (ASESORIA) | `Puerta 2 · quiz: {{cf_q_disc}} · presup {{cf_q_presup}} · mide {{cf_q_altura}}` |
| CONTACTO | `Puerta 2 · dio teléfono solo · dijo: {{cf_mensaje}}` |
| GARANTIA / PAGOS | `Puerta 2 · POSTVENTA/FAQ · dijo: {{cf_mensaje}}` |
| VENDER | `Puerta 2 · VENDE: {{cf_v_modelo}} {{cf_v_anio}} · dijo: {{cf_mensaje}}` |

> Con un solo bloque A2+SE3 no se pueden tener 5 notas distintas. Solución sin crear
> campos: **`cf_modelo_texto` es el portador de la etiqueta de ruta**. Las rutas
> marcadas (VENDER · CONTACTO · GARANTIA/PAGOS) lo setean antes de mandar a B4
> (`· VENDE: {{cf_v_modelo}} {{cf_v_anio}}` · `· dio teléfono solo` · `· POSTVENTA/FAQ`);
> las rutas de compra no lo tocan (llega vacío porque se borra al inicio de la ruta).
> Body único:
> ```json
> {
>   "handle": "<Nombre de usuario>",
>   "telefono": "{{cf_telefono}}",
>   "bici": "{{cf_hero_bici}}",
>   "notas": "Puerta 2 {{cf_modelo_texto}} · dijo: {{cf_mensaje}}"
> }
> ```
> `bici` va vacío si la ruta no pasó por match — el ticket nace sin brief, correcto.
> **Sin `reel` · sin `ciudad` · sin `franja` · sin `optin`.**
>
> 📣 **Aviso multi-persona (mejora operativa pedida 2026-07-30):** el backend ya soporta
> varios destinatarios — `AVISO_LLAMADO_SIDS` = subscriber IDs separados por coma (hoy:
> Luis). Cuando el equipo esté definido: cada miembro le escribe UNA vez al WhatsApp del
> negocio (para nacer como contacto con ID), se agregan sus IDs a la env y se redespliega.
> ⛔ **Grupos de WhatsApp NO**: la API de WhatsApp Business no soporta mensajes a grupos
> (limitación de Meta). El «quién lo toma» se coordina en el grupo interno del equipo.

## Etapa 2 · El quiz — los 8 bloques, desglosados

> Es el mismo quiz de los reels sin bici, adaptado al DM: sin `reel`, sin `origen`, y la
> salida de la ficha va a C-OFERTA. La ficha rica (SE-F → C1b → B2-Q/B2-QE) se construye
> UNA vez y la comparten esta etapa y el Grupo A — está desglosada en la Etapa 3.

### LOS 31 CAMPOS QUE SE BORRAN (referencia — los usan QZ0 acá y A-2 en la Etapa 3)
```
cf_bici_modelo · cf_bici_talla · cf_bici_puntaje · cf_bici_area_baja
cf_bici_estado_honesto · cf_bici_precio · cf_bici_precio_nuevo · cf_bici_ahorro
cf_bici_rango_altura · cf_bici_foto · cf_bici_ficha · cf_bici_disponible
cf_bici_bateria · cf_bici_ciclos
cf_hero_bici · cf_hero_modelo · cf_hero_talla · cf_hero_precio · cf_hero_ficha · cf_hero_foto
cf_alt_bici · cf_alt_modelo · cf_alt_precio · cf_alt_ficha
cf_otras · cf_match · cf_q_disc · cf_q_presup · cf_q_altura · cf_lead_id · cf_modelo_texto
```
*(Copiar y pegar los nombres, nunca tipearlos: `setCustomFieldByName` es match exacto.)*

### QZ0 · La entrada al quiz — Acciones + 2 solicitudes externas, en este orden
1. **Acción → Borrar valor** de los **31 campos** de arriba.
2. **Solicitud externa `mc-lead`** — POST · `Content-Type: application/json`
```
https://biketrust-sitio.pages.dev/api/mc-lead?key=<MC_KEY>
```
```json
{ "handle": "<Nombre de usuario>", "canal": "DM IG" }
```
   Sin mapeo de respuesta.
3. **Solicitud externa `mc-evento`** (marca el inicio del cuestionario para el tablero):
```
https://biketrust-sitio.pages.dev/api/mc-evento?key=<MC_KEY>
```
```json
{ "handle": "<Nombre de usuario>", "estado": "quiz_iniciado", "soloEstado": true }
```
   Sin mapeo. Siguiente paso → **QZ**.

### QZ · Las 3 preguntas — UN bloque de mensaje con entradas secuenciales
**1/3 — Elección múltiple** → guardar en `cf_q_disc` · con botón «Omitir»:
```
1/3 · ¿En qué vas a andar? 🚵
```
| Botón | Valor que guarda |
|---|---|
| `MTB / cerro` | el texto del botón (el backend lo canonicaliza) |
| `Ruta` | ídem |
| `Ciudad` | ídem |

**2/3 — Texto** → guardar en `cf_q_presup`:
```
2/3 · ¿En cuánto anda tu presupuesto? 💸

Escríbelo como quieras: 3.500.000 · 3,5 millones · «flexible», da lo mismo.
```
**3/3 — Texto** → guardar en `cf_q_altura`:
```
3/3 · ¿Cuánto mides? 📏

(1,75 o 175, como te acomode)
```
- Expiración de la recopilación: **30 minutos**. Respuesta válida del 3/3 → **SE-Q**.

### SE-Q · El motor — solicitud externa `mc-match` (modo B)
```
https://biketrust-sitio.pages.dev/api/mc-match?key=<MC_KEY>
```
```json
{
  "handle": "<Nombre de usuario>",
  "disciplina": "{{cf_q_disc}}",
  "presupuesto": "{{cf_q_presup}}",
  "altura": "{{cf_q_altura}}"
}
```
- **SIN `reel` y SIN `origen`** (el default del endpoint es `Puerta 2 (quiz)`).
- El backend tolera texto libre («3,5 millones», «175», el texto del botón de disciplina).
- **Mapeo de respuesta (13 pares, rutas planas):**

| JSONPath | → Custom field |
|---|---|
| `$.match` | `cf_match` |
| `$.heroBici` | `cf_hero_bici` |
| `$.heroModelo` | `cf_hero_modelo` |
| `$.heroTalla` | `cf_hero_talla` |
| `$.heroPrecio` | `cf_hero_precio` |
| `$.heroFicha` | `cf_hero_ficha` |
| `$.heroFoto` | `cf_hero_foto` |
| `$.altBici` | `cf_alt_bici` |
| `$.altModelo` | `cf_alt_modelo` |
| `$.altPrecio` | `cf_alt_precio` |
| `$.altFicha` | `cf_alt_ficha` |
| `$.otrasTexto` | `cf_otras` |
| `$.leadId` | `cf_lead_id` |

Siguiente paso → **C-Q**.

### C-Q · ¿Hubo match? — Condición
- `cf_match` **es igual a** `true` *(texto — el endpoint escribe la palabra)* → **SE-F**
  (la ficha rica compartida, Etapa 3).
- Si no → **NM**.

### NM · La salida honesta del quiz — Mensaje
```
Te soy derecho: de lo que tengo HOY, ninguna calza bien con lo que me dijiste 🙈

Pero si sabes lo que buscas, te la conseguimos. Todas las semanas salimos a buscar modelos específicos para gente que nos los encarga.

¿Te contactamos con nuestro especialista para que te asesore?
```
| Botón | Chars | Destino |
|---|---|---|
| `Sí, que me llamen` | 17 | → **B4** (directo, se salta B3) |
| `Ver lo que hay ahora` | 20 — límite exacto | → **B2-C** |

## Etapa 3 · Grupo A · `MODELO` (54 % del tráfico) — autocontenida

> El viaje: la persona nombró una bici («tienen la Levo SL?») → nace/actualiza el Lead →
> se limpia el terreno → `mc-match` la busca en el stock VIVO → si está: ficha rica →
> oferta de llamada · si no está: encargo honesto. **Entrada: la rama `MODELO` de E-4.**

### A-1 · `mc-lead` — solicitud externa (SIEMPRE primero: crea/actualiza el Lead)
POST · `Content-Type: application/json`
```
https://biketrust-sitio.pages.dev/api/mc-lead?key=<MC_KEY>
```
```json
{ "handle": "<Nombre de usuario>", "canal": "DM IG" }
```
- `<Nombre de usuario>` = campo de sistema de Instagram **desde el selector**, nunca tipeado.
- Sin mapeo de respuesta (el `leadId` lo trae `mc-match` en A-4).
- ⚠️ No mandar `nombre` (llegaría el literal `{{full_name}}`).
Siguiente paso → **A-2**.

### A-2 · Acción: borrar los 31 campos
Los mismos 31 de la lista de la Etapa 2 — cópialos de ahí, son:
```
cf_bici_modelo · cf_bici_talla · cf_bici_puntaje · cf_bici_area_baja
cf_bici_estado_honesto · cf_bici_precio · cf_bici_precio_nuevo · cf_bici_ahorro
cf_bici_rango_altura · cf_bici_foto · cf_bici_ficha · cf_bici_disponible
cf_bici_bateria · cf_bici_ciclos
cf_hero_bici · cf_hero_modelo · cf_hero_talla · cf_hero_precio · cf_hero_ficha · cf_hero_foto
cf_alt_bici · cf_alt_modelo · cf_alt_precio · cf_alt_ficha
cf_otras · cf_match · cf_q_disc · cf_q_presup · cf_q_altura · cf_lead_id · cf_modelo_texto
```
*(Por qué: el mapeo de ManyChat NO limpia campos que llegan vacíos — sin este borrado se
arrastra la bici o el match de la corrida anterior. La falla más silenciosa del sistema.)*
Siguiente paso → **A-3**.

### A-3 · Condición: ¿`cf_modelo_buscado` está vacío?
- `cf_modelo_buscado` **no tiene valor** → **BICI_SUELTA** (Etapa 4). **NUNCA llamar a
  `mc-match` con el campo vacío** (devolvería No-match fantasma).
- Tiene valor → **A-4**.

### A-4 · SE `mc-match` modo A — solicitud externa
POST · `Content-Type: application/json`
```
https://biketrust-sitio.pages.dev/api/mc-match?key=<MC_KEY>
```
```json
{
  "handle": "<Nombre de usuario>",
  "modelo": "{{cf_modelo_buscado}}",
  "origen": "Puerta 2 (DM)"
}
```
🚨 **`cf_modelo_buscado` (la salida 2 del AI Step), NUNCA `cf_mensaje`** — con el DM
completo («tienen la Levo SL?») el matching devuelve No-match teniendo la bici: «tienen»
y «la» puntúan cero. Solo el nombre limpio calza. El matching tolera typos («quenevo» →
Kenevo, «swork» → S-Works).
**Mapeo de respuesta (13 pares, rutas planas):**

| JSONPath | → Custom field |
|---|---|
| `$.match` | `cf_match` |
| `$.heroBici` | `cf_hero_bici` |
| `$.heroModelo` | `cf_hero_modelo` |
| `$.heroTalla` | `cf_hero_talla` |
| `$.heroPrecio` | `cf_hero_precio` |
| `$.heroFicha` | `cf_hero_ficha` |
| `$.heroFoto` | `cf_hero_foto` |
| `$.altBici` | `cf_alt_bici` |
| `$.altModelo` | `cf_alt_modelo` |
| `$.altPrecio` | `cf_alt_precio` |
| `$.altFicha` | `cf_alt_ficha` |
| `$.otrasTexto` | `cf_otras` |
| `$.leadId` | `cf_lead_id` |

Siguiente paso → **A-5**.

### A-5 · Condición `cf_match` es `true`
- **Sí** → **SE-F** (la ficha rica compartida, abajo).
- **No** → **NM-A** (paso propio, NO el copy de «se vendió» — acá puede ser un modelo que
  nunca tuvimos, y afirmar una venta que no ocurrió es lo único prohibido):
```
Te soy derecho: hoy no tenemos ninguna que calce con eso 🙈

Si es la que andabas buscando, te la conseguimos. Todas las semanas salimos a buscar modelos específicos para gente que nos los encarga.

¿Te contactamos con nuestro especialista para que te asesore?
```
| Botón | Destino |
|---|---|
| `Sí, que me llamen` | → B4 (directo) |
| `Ver lo que hay ahora` | → B2-C |

### LA FICHA RICA COMPARTIDA (la usan A-5 del Grupo A y C-Q del quiz)

#### SE-F · `mc-evento` con `soloEstado` — solicitud externa
```
https://biketrust-sitio.pages.dev/api/mc-evento?key=<MC_KEY>
```
```json
{ "lead": "{{cf_lead_id}}", "bici": "{{cf_hero_bici}}", "soloEstado": true }
```
Con `soloEstado: true` no crea Interés (ya lo creó `mc-match`) y, al no mandar `estado`,
no mueve el Estado del Lead. **Mapeo de respuesta (15 pares, rutas planas):**

| JSONPath | → Custom field |
|---|---|
| `$.biciModelo` | `cf_bici_modelo` |
| `$.biciTalla` | `cf_bici_talla` |
| `$.biciPuntaje` | `cf_bici_puntaje` |
| `$.biciAreaBaja` | `cf_bici_area_baja` |
| `$.biciEstadoHonesto` | `cf_bici_estado_honesto` |
| `$.biciPrecio` | `cf_bici_precio` |
| `$.biciPrecioNuevo` | `cf_bici_precio_nuevo` |
| `$.biciAhorro` | `cf_bici_ahorro` |
| `$.biciRangoAltura` | `cf_bici_rango_altura` |
| `$.biciFoto` | `cf_bici_foto` |
| `$.biciFicha` | `cf_bici_ficha` |
| `$.biciDisponible` | `cf_bici_disponible` |
| `$.biciBateria` | `cf_bici_bateria` |
| `$.biciCiclos` | `cf_bici_ciclos` |
| `$.leadId` | `cf_lead_id` |

Siguiente paso → **C1b**.

#### C1b · ¿Es eléctrica? — Condición
- `cf_bici_bateria` **tiene algún valor** → **B2-QE** · Si no → **B2-Q**.

#### B2-Q · La ficha del hero — Mensaje solo texto (una burbuja o cortada donde acomode)
```
De lo que tengo disponible HOY, la que más se acerca a lo tuyo es esta 👇

{{cf_bici_modelo}} · Talla {{cf_bici_talla}}

Sacó {{cf_bici_puntaje}}/7 en nuestra inspección — y en la ficha te digo exactamente dónde perdió puntos, sin maquillaje. Eso casi nadie te lo muestra.

Nueva hoy sale {{cf_bici_precio_nuevo}}. Esta queda en {{cf_bici_precio}} → te ahorras {{cf_bici_ahorro}}.

Fotos reales, diagnóstico completo y su estado honesto, tal cual está:
{{cf_bici_ficha}}

La talla exacta se confirma contigo — Luis te lo dice al teléfono según tu estatura.
```
Salida → **C-OTRAS**.

#### B2-QE · La ficha e-bike — duplicar B2-Q e insertar ANTES de las líneas de precio:
```
Diagnóstico de batería: {{cf_bici_bateria}}% de salud · {{cf_bici_ciclos}} ciclos. Regla nuestra: bajo 80% no la vendemos.
```
Salida → **C-OTRAS**.

#### C-OTRAS · ¿Hay más de una que calza? — Condición *(solo aplica al Grupo A)*
- `cf_otras` **tiene algún valor** → **B2-OTRAS** · Si no → **C-ALT**.
*(En el camino del quiz `cf_otras` siempre llega vacío — se borró en QZ0 y modo B no lo
devuelve — así que salta solo a C-ALT.)*

#### B2-OTRAS · Las otras coincidencias — Mensaje, sin botones
```
{{cf_otras}}
```
*(La línea viene redactada del endpoint: «También tengo: … Escríbeme el nombre exacto si
prefieres una de esas.»)* Salida → **C-ALT**.

#### C-ALT · ¿Hay alternativa? — Condición
- `cf_alt_modelo` **tiene algún valor** → **B2-ALT** · Si no → **C-OFERTA** (Etapa 1).

#### B2-ALT · La alternativa — Mensaje, sin botones
```
También te podría servir: {{cf_alt_modelo}} · {{cf_alt_precio}}
{{cf_alt_ficha}}
```
Salida → **C-OFERTA** (Etapa 1).

## Etapa 4 · Los códigos cortos

### BICI_SUELTA — Mensaje con 3 botones *(copy corregido 2026-08-03: el anterior pedía
escribir Y ofrecía botones que iban a otra cosa — señales cruzadas)*
```
¿Cuál de todas? 🚲 Escríbeme el nombre y te la ubico al toque: Levo, Epic, Creo, Tarmac, Stumpjumper…

¿No sabes cuál? Dale a un botón 👇
```
| Botón | Chars | Destino |
|---|---|---|
| `Ayúdenme a elegir` | 17 | → **QZ0** (el quiz) |
| `Que me llamen mejor` | 19 | → **B4** |

- **Máximo 2 botones (decisión Gabriel 2026-08-03):** se eliminó «Ver lo que hay ahora» —
  mandar al catálogo a quien no sabe cuál busca es dejarlo solo mirando vitrina; el quiz
  cubre ese caso guiado y capturando datos.
- **El camino principal es ESCRIBIR el nombre**: ese texto cae al Default Reply → vuelve a
  entrar al enrutador → sale como MODELO con el nombre extraído. No cuenta golpe.
- Los botones son la salida explícita para quien NO tiene el nombre — no contradicen el
  copy: el mensaje pide una cosa y ofrece la alternativa aparte.

### CONTACTO — 2 bloques nuevos → B4
La persona dejó su número o pidió que la llamen. Aunque YA escribió el número, viene
mezclado con texto — se le pide confirmarlo para capturarlo validado.

**C-1 · Acción** (tipo «Establecer campo de usuario») — la nota para Luis en el ticket:
- Campo: `cf_modelo_texto` · Valor: `· dio teléfono solo`

**C-2 · Mensaje** (sin botones):
```
Dale, te llamamos 🙌 Confírmame el número tal cual, para no equivocarnos.
```
**Cables:** rama CONTACTO de E-4 → C-1 → C-2 → **B4** (el bloque de teléfono existente de
la Etapa 1 — no crear otro). ⚠️ NUNCA volcar el mensaje crudo en `cf_telefono`: rompería
el ID de WhatsApp. B4 valida y guarda limpio.

### SALUDO — invitación abierta, SIN botones, SIN contar golpe
*(Corregido 2026-08-03, objeción de Gabriel: el pivote es «sin menú — el bot reconoce la
intención del texto libre», y responderle un menú al primer «hola» resucitaba lo que se
mató. La respuesta abierta deja que el siguiente mensaje pase por el enrutador, que para
eso está. Los 3 botones quedan SOLO en el golpe 1 del anti-bucle — ahí son un rescate
tras dos fallos, no un menú de bienvenida.)*
```
¡Hola! 👋 Cuéntame qué andas buscando — un modelo (Levo, Epic, Creo…), ayuda para elegir, o lo que necesites 🚲
```
- Sin botones, sin siguiente paso: su respuesta cae al Default Reply → enrutador → su ruta.
- No incrementa `cf_no_reconocido` (un «hola» no es un fallo).

## Etapa 5 · Grupo C · `VENDER`

**V-1 a V-4 · Captura — 4 pasos de entrada de texto, uno por dato:**
1. `¿Qué bici tienes? Marca y modelo 🚲` → `cf_v_modelo`
2. `¿De qué año es?` → `cf_v_anio`
3. `¿Qué talla?` → `cf_v_talla`
4. `Cuéntame cómo está: kilómetros, si tiene algo suelto o algún golpe. Mientras más derecho seas, más firme es el número que te damos — así no te lo bajamos después de verla 🙌` → `cf_v_estado`
   ⚠️ **entrada de UNA línea** — el texto viaja crudo a la plantilla del staff y un salto
   de línea hace que Meta rechace el aviso sin error visible.

**V-5 · Condición:** `cf_v_modelo` no vacío (mc-consigna da 422 si falta) → V-6; vacío → V-1.

**V-6 · SE `mc-consigna`:**
```json
{
  "handle": "<Nombre de usuario>",
  "modelo": "{{cf_v_modelo}}",
  "anio": "{{cf_v_anio}}",
  "talla": "{{cf_v_talla}}",
  "estadoBici": "{{cf_v_estado}}",
  "notas": "Puerta 2 · DM"
}
```
Mapeo: `$.consignaId` → `cf_consigna_id`. *(Se llama ANTES del teléfono a propósito: si
no da el número, la consignación igual queda registrada y avisada.)*

**V-7 · El puente — paso de texto:**
```
Listo, ya lo tengo. Para tasarla te llama Luis — es el que inspecciona todas las bicis que entran, con la misma nota de 1 a 7 que ves en nuestras fichas.

Te dice derecho qué vale y si la recibimos o no: bajo 4 no la tomamos, y preferimos decírtelo por teléfono antes de hacerte venir.
```
**V-8 · Acción** (bloque nuevo, tipo «Establecer campo de usuario») — la nota para Luis:
- Campo: `cf_modelo_texto` · Valor: `· VENDE: {{cf_v_modelo}} {{cf_v_anio}}`
**Cables:** V-7 → V-8 → **B4**.

## Etapa 6 · Grupo D + la guarda de segunda vuelta

### C-OFERTA · Condición (la Guarda 1 del runbook §5.4-bis)
- `cf_oferta_enviada` **es** `si` → **B4** (ya recibió la oferta; solo falta el número).
- Si no → **D1** (40 s → A1 → B3, la convergencia normal).

> ⚠️ **2026-07-30: C2 (el guard post-delay) fue ELIMINADO de las puertas de comentarios y
> quiz** — en el as-built B3 tiene una sola vía de entrada y C2 solo mataba al que volvía.
> En ESTA puerta la protección de segunda vuelta es C-OFERTA, y su rama «sí» **acorta** el
> camino (→ B4); **nunca deja al contacto sin respuesta**. No montar ningún C2 acá tampoco:
> el tramo es `D1 → A1 → B3` directo.

*La usan: la salida de la ficha (match), BICI_SUELTA, SALUDO y NO_CLASIFICA.*

### VISITA — paso de texto (señal de compra; responder COMPLETO)
```
Estamos en Av. Las Condes 12461, Las Condes 📍

Horario: lunes a viernes de 9:00 a 20:00, y sábado de 10:00 a 14:00.

Antes de que vengas, ¿te tinca que te llame Luis? Así te dice qué hay hoy en tu talla y no llegas a mirar vitrina.
```
| Botón | Destino |
|---|---|
| `Sí, que me llamen` | → B4 |
| `Por ahora no` | → B7 |

### ENVIOS — paso de texto
```
Sí, despachamos a regiones. El costo y el plazo dependen de dónde estés, y eso te lo cuadra Luis mejor por teléfono que yo por acá 🙂

¿Te llamamos y de paso te resuelve todo lo demás?
```
Botones: `Sí, que me llamen` → B4 · `Por ahora no` → B7.

### GARANTIA — Mensaje con contenido real *(2026-08-03: llegó el doc de garantía — ya no
es fallback ciego. Fuente: «Garantia Biketrust v2.docx», resumen conservador porque el
documento está sujeto a revisión legal)*
```
Sí 🙌 Todas nuestras bicis salen con garantía Bike Trust de 6 meses: si un componente falla, lo reparamos sin costo — repuesto y mano de obra. No cubre golpes ni el desgaste normal de uso.

Y algo que casi nadie ofrece: nos comprometemos a recomprarte la bici dentro de 18 meses, previa evaluación de su estado.

¿Te llamamos y Luis te cuenta el detalle según tu caso?
```
| Botón | Destino |
|---|---|
| `Sí, que me llamen` | → **G-1** → **B4** |
| `Por ahora no` | → **B7** |

- ⚠️ **No agregar más detalle que este** (plazos de respuesta, talleres, condiciones de la
  recompra): el documento aún está en revisión legal y con campos sin completar. El detalle
  fino lo da Luis. Cuando el doc quede firmado, se re-evalúa cuánto más puede decir el bot
  (y alimentar la web y el futuro AI hub).

### PAGOS — fallback (decisión 2026-08-03: las consultas específicas se derivan a llamada)
```
Eso te lo explica mejor Luis en dos minutos que yo por acá 🙂

¿Te llamamos y de paso te resuelve todo lo demás?
```
| Botón | Destino |
|---|---|
| `Sí, que me llamen` | → **G-1** → **B4** |
| `Por ahora no` | → **B7** |

⚠️ **Los botones son obligatorios** — sin botón de flujo la pregunta queda retórica y el
lead muere ahí.

### G-1 — Acción compartida por GARANTIA y PAGOS (la nota para Luis)
- Set custom field → `cf_modelo_texto` = `· POSTVENTA/FAQ` → siguiente: **B4**.
- Distingue el reclamo/consulta de postventa de un lead de compra en el Kanban.

### TECNICA — pregunta de especificación (ruta nueva 2026-07-30, caso real Joshua G.)
*«¿Esos neumáticos sirven para tubeless?» — pregunta técnica que la ficha no siempre
responde. Señal de compra alta: nadie pregunta por tubeless sin estar considerándola.*
```
Buena pregunta 🙌 Esa es de las que responde Luis — él inspeccionó personalmente cada bici que tenemos.

¿Te llamamos y te la responde al tiro? Si prefieres seguir por acá, te lo averiguo y te escribo.
```
| Botón | Destino |
|---|---|
| `Sí, que me llamen` | → **T-1** (bloque de Acción nuevo: `cf_modelo_texto` = `· TÉCNICA: {{cf_mensaje}}`) → **B4** |
| `Prefiero por acá` | → **T-2** |

**T-2 · derivación a humano con contexto** (acciones en orden):
1. **Notificar a administradores** (la pregunta queda visible en la bandeja vía `cf_mensaje`).
2. Setear `cf_modo_humano` = `si` (el bot no pisa la respuesta del humano).
3. Mensaje: `Dale 👌 Dame un rato y te escribo por acá con la respuesta.`
4. Smart Delay 24 h → borrar `cf_modo_humano` (el mismo cool-off del anti-bucle).

### CIERRE — despedida o rechazo cortés (ruta nueva 2026-07-30, caso real Joshua G.)
*«Muchas gracias» · «lo voy a pensar, estoy barajando opciones». La persona está cerrando;
responderle con un menú de botones (lo que hacía NO_CLASIFICA) es venderle a quien ya dijo
que no. Respuesta blanda, SIN botones, SIN gastar golpe del anti-bucle:*
```
Dale, sin apuro 👌 Cualquier cosa me escribes por acá.

Y si más adelante quieres ver alguna, me dices y coordinamos al tiro 🙌
```
Sin siguiente paso — fin.

## Etapa 7 · El anti-bucle — los 8 bloques (`NO_CLASIFICA` y cualquier valor inesperado)

> La red de seguridad: convierte «no te entendí» en un lead (golpe 1) o en una derivación
> a humano con retorno automático (golpe 2). **Entrada: la rama NO_CLASIFICA de E-4 Y la
> rama ELSE** (cualquier valor fuera de los 12 códigos — ambas apuntan a AB-1).
> Recordatorio: SALUDO, BICI_SUELTA, CIERRE y E-2 **nunca** consumen golpes.

### AB-1 · ¿Ya falló antes? — Condición
- `cf_no_reconocido` **tiene algún valor** → **AB-4** (segundo golpe: a humano).
- Vacío → **AB-2** (primer golpe: rescate con botones).

### AB-2 · Marcar el primer golpe — Acción
- Set custom field → `cf_no_reconocido` = `1` → siguiente: **AB-3**.

### AB-3 · El rescate — Mensaje con 3 botones *(el ÚNICO menú legítimo del sistema:
acá ya fallamos dos veces en entender; guiar es rescate, no bienvenida)*
```
Puede que me haya perdido 🙈 Dime en qué te ayudo:
```
| Botón | Chars | Destino |
|---|---|---|
| `Busco una bici` | 14 | → **BICI_SUELTA** |
| `Ayúdenme a elegir` | 17 | → **QZ0** (el quiz) |
| `Quiero vender` | 13 | → **V-1** |

- Si en vez de botón escribe de nuevo → Default Reply → enrutador: si ahora clasifica,
  sigue su ruta (el golpe queda marcado pero no molesta); si vuelve a NO_CLASIFICA,
  AB-1 lo manda al golpe 2.

### AB-4 · Silenciar al bot — Acción
- Set custom field → `cf_modo_humano` = `si` → siguiente: **AB-5**.

### AB-5 · Avisar al equipo — Acción nativa «Notificar a administradores»
- Push/email de ManyChat: conversación varada con intención real; alguien la toma en la
  bandeja (el historial completo está ahí). → siguiente: **AB-6**.

### AB-6 · La despedida honesta — Mensaje, sin botones
```
Mejor te contesta una persona 🙂 Dame un rato y te escribo por acá.
```
→ siguiente: **AB-7**.

### AB-7 · El cool-off — Smart Delay de **24 horas**
→ al vencer: **AB-8**.

### AB-8 · El retorno automático — Acción
- **Borrar valor** de `cf_modo_humano` **y** de `cf_no_reconocido`. Sin siguiente paso.
- El contacto vuelve solo al circuito automático al día siguiente, con los golpes
  reseteados — la regla original del pivote es «el bot no retoma DENTRO de las 24 h»,
  no «nunca». Si Luis quiere silencio más largo, re-setea `cf_modo_humano` a mano.

### Checklist de cables de la etapa
```
E-4 (NO_CLASIFICA) → AB-1     E-4 (ELSE, cualquier otro valor) → AB-1
AB-1  vacío → AB-2 → AB-3 (botones → BICI_SUELTA · QZ0 · V-1)
AB-1  con valor → AB-4 → AB-5 → AB-6 → AB-7 (24 h) → AB-8 (fin)
```

- Comportamiento conocido y aceptado: el contador NO se limpia cuando una ruta posterior
  clasifica bien — solo lo limpia AB-8. O sea, un fallo hoy + un fallo la próxima semana
  = golpe 2 directo. Es conservador a propósito (prefiere derivar a humano antes que
  marear); el cool-off lo deja siempre reversible.

⚠️ **NO usar la «Pausa de automatizaciones 24 h» nativa**: suspende también la regla de
baja (choque conocido, runbook §5.3).

## Etapa 8 · La entrada — el enrutador

### E-0 · Disparador: **CUALQUIER DM** (sin keywords)
+ **agregar el disparador de respuesta a historia** apuntando al mismo flujo (si no se
agrega, ese tráfico no enciende nada y no da error — §5.10.5).
⚠️ La regla de baja R1 ya existe (automatización aparte, de la puerta de comentarios) y
corre antes — **no recrearla**.

### E-1 · Condición: `cf_modo_humano` es `si` → **nada** (el bot se calla). Si no → E-2.

### E-2 · Mensaje sin texto (audio / foto / sticker / post compartido) — SIN contar golpe

**Diseño FINAL (Gabriel 2026-07-30): un solo tratamiento para todo lo que no sea texto —
la excusa genérica, culpándole a Instagram, una sola vez.** Sin distinguir tipos de adjunto
(ya no hace falta verificar si el builder puede).

```
Chuta, no me deja abrir lo que me mandaste 🙈 ¿Me lo escribes por acá? Si es una bici, con el nombre del modelo me basta y te lo reviso al tiro.
```

Secuencia del bloque:
1. **¿`cf_excusa_enviada` = `si`?** → NO repetir la excusa: solo notificar admins. FIN.
2. Vacío → setear `cf_excusa_enviada` = `si` → **la excusa** → **notificar administradores**
   (acción nativa; respaldo: si la persona no re-escribe, el humano pesca el audio/post
   desde la bandeja con todo el contexto). FIN.

- La guarda cubre el caso borde del combo (post compartido + audio explicándolo): cada
  mensaje dispara por separado, pero la excusa sale UNA vez.
- **Se rearma en E-3**: cuando llega texto, se borra `cf_excusa_enviada`.
- `cf_excusa_enviada` es el custom field nº 26 de esta puerta.
- Si responde con el nombre del modelo → cae al enrutador como MODELO. El humano solo
  interviene si la persona no convierte.

*(Contexto técnico: **ManyChat no expone qué publicación compartieron** — sin texto, sin
shortcode, sin URL — y no existe disparador de «post compartido»; por eso la excusa que
convierte a texto es el único embudo posible para ese tráfico.)*

**Las puertas de intervención humana quedan en dos:** E-2 cuando la persona no convierte a
texto (aviso de respaldo) · golpe 2 del anti-bucle (aviso + modo humano con cool-off 24 h).

### E-3 · Acción: guardar el mensaje en `cf_mensaje` + borrar `cf_excusa_enviada`
**ANTES del AI Step, no dentro de una ruta** — si se guarda solo en la ruta de modelo, en
el resto llega vacío o arrastrado del mensaje anterior. El borrado de `cf_excusa_enviada`
rearma la guarda anti-repetición de E-2 (llegó texto: la sesión de adjuntos terminó).

### E-4 · AI STEP · el enrutador
- Campo «objetivo» y campo «contexto»: **pegar TAL CUAL del runbook §5.2** (incluyen las
  10 rutas, las reglas de desempate y las prohibiciones).
- Salidas: `cf_intencion` + `cf_modelo_buscado` (o el mecanismo de saltos que la pantalla
  ofrezca — §5.10.1).
- **Ramas por valor de `cf_intencion`:**

| Valor | Destino |
|---|---|
| `MODELO` | → A-1 (Etapa 3) |
| `BICI_SUELTA` | → BICI_SUELTA |
| `ASESORIA` | → **QZ0** (el quiz — decisión 2026-07-30) |
| `VENDER` | → V-1 directo (sin mc-lead previo: `mc-consigna` crea/actualiza el Lead con `Canal = Consignación`) |
| `CONTACTO` | → CONTACTO |
| `ENVIOS` | → ENVIOS |
| `GARANTIA` | → GARANTIA (responde con el resumen real de la garantía — doc 2026-08-03) |
| `PAGOS` | → PAGOS (fallback: deriva a llamada) |
| `TECNICA` | → TECNICA (Luis responde · llamada o «te averiguo») |
| `VISITA` | → VISITA |
| `SALUDO` | → SALUDO |
| `CIERRE` | → CIERRE (despedida blanda, sin botones, sin golpe) |
| `NO_CLASIFICA` **y CUALQUIER OTRO VALOR (rama else)** | → anti-bucle |

*(12 códigos desde 2026-07-30 — TECNICA y CIERRE salieron de la conversación real de
Joshua G.: una pregunta de tubeless y un «gracias, lo voy a pensar» que el diseño de 10
rutas habría mandado al anti-bucle.)*

🚨 **La rama «else» es obligatoria** — si el AI emite cualquier cosa fuera de las 10
cadenas y no hay else, el flujo muere en silencio: ni mensaje, ni Lead, ni métrica.
Es la fuga 100 % invisible del runbook §5.1.

## Las 4 verificaciones de pantalla (§5.10) — hacerlas DURANTE el montaje

1. Cómo entrega el AI Step sus 2 salidas (campos vs saltos).
2. Que la regla de baja corra antes que el AI Step, y que B4/V-1..4 (pasos esperando
   respuesta) no se traguen la palabra de baja.
3. Que el AI Step pueda quedar MUDO (si obliga a hablar: «Dame un segundo 👀»).
4. Qué pasa con 5 DMs seguidos (¿se encolan o disparan 5 flujos?) y si se acaba la
   cuota de IA (→ debe caer en la rama else).

## Prueba E2E (cuenta con `cf_oferta_enviada` limpio)

| # | Mensaje de prueba | Esperado |
|---|---|---|
| 1 | `tienen la levo sl?` | ficha rica de la Levo SL + Interés `Match` con `Es hero` · luego B3 a los 40 s |
| 2 | `cuánto vale?` (sin nombrar) | «¿Cuál de todas?» — y NO nace Interés fantasma |
| 3 | `busco una para el cerro, ando en 4 palos, mido 1.75` | `ASESORIA` → quiz → ficha del hero |
| 4 | `vendo mi bici` | captura 4 datos → registro en Consignaciones ANTES del teléfono + aviso a Roberto |
| 5 | `dónde están?` | dirección + horario + oferta de llamada |
| 6 | `+56 9 1234 5678` | CONTACTO → eco B5 → ticket |
| 7 | `asdfghjkl` ×2 | golpe 1 (botones) → golpe 2 (modo humano, bot mudo al 3er mensaje) |
| 8 | audio | «Lo mío es el texto» y NO consume golpe |
| 9 | `stop` | Unsubscribe seco, sin pasar por el AI Step |
| 10 | Al terminar | borrar Leads/Intereses/tickets de prueba por id |

## Gestión por persona (creado 2026-07-30, lo consume el tablero del ítem 5)

En `Llamados` existen **`Atiende`** (single select Luis · Roberto · Alfonso — quien toma el
ticket se marca; opciones nuevas se agregan a mano) y **`_atiende_desde`**
(`LAST_MODIFIED_TIME({Atiende})`, el sello de cuándo se tomó). Con eso + `Creado` +
`Fecha primera llamada` + `Aviso salida enviado`, el tablero podrá mostrar **quién gestiona
qué y cuánto demora en cada paso**. Pendiente manual: mostrar `Atiende` en las tarjetas del
Kanban y en «Detalle de Llamados». Backend: sin cambios por ahora.

## Evaluación post-go-live (NO para esta pasada) — AI hub de ManyChat

Investigado 2026-07-30: el **AI Agent / AI hub (beta)** de ManyChat genera respuestas desde
un Knowledge Base estático — incompatible con el funnel (no llama APIs, no ve el stock vivo,
no crea tickets, y redacta libre: justo lo que este negocio no puede permitirse). El **AI
Step clasificador** es el uso correcto y el previsto por la plataforma. Donde el hub SÍ
podría sumar después: **capa de FAQs no transaccionales** (garantía/envíos/políticas) cuando
exista la garantía escrita de Roberto — texto aprobado al Knowledge Base + confidence limits
derivando a humano. Requiere resolver el choque con el disparador «cualquier DM».

## Go-live de la puerta (al activarla se completa el reemplazo de la V1)

Es el §9 del runbook: rotar `MC_KEY` (la `MC_KEY_V2` de `.dev.vars`) + redeploy +
actualizar la llave en TODAS las solicitudes externas · apagar las automatizaciones V1 ·
al día siguiente, borrar los 13 custom fields muertos. **Coordinar conmigo el redeploy.**
