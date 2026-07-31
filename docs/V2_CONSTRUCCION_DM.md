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

## Etapa 1 · Convergencia y cierre — idénticos a la hoja del quiz

Construir igual: **B7 · B6 · B6-D · C3 · B4 · B5 · B3 · A1 · C2 · D1 (40 s) · B2-C**.

**A2+SE3 (`mc-llamado`) — la única diferencia está en `notas`, que cambia POR RUTA**
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

## Etapa 2 · El quiz — reusar la construcción de la hoja del quiz

**QZ0 → QZ (3 preguntas) → SE-Q → C-Q → SE-F → C1b-Q → B2-Q/B2-QE → C-ALT → B2-ALT → NM**
idénticos a [`V2_CONSTRUCCION_QUIZ.md`](V2_CONSTRUCCION_QUIZ.md), con 3 diferencias:
1. SE-Q **sin `reel`** y **sin `origen`** (el default del endpoint es `Puerta 2 (quiz)`).
2. La salida de B2-Q/B2-QE/B2-ALT va a **C-OFERTA** (ver Etapa 6), no directo a D1.
3. NM: botones `Sí, que me llamen` → B4 · `Ver lo que hay ahora` → B2-C.

## Etapa 3 · Grupo A · `MODELO` (54 % del tráfico)

### A-1 · `mc-lead` — solicitud externa
```json
{ "handle": "<Nombre de usuario>", "canal": "DM IG" }
```

### A-2 · Acción: borrar los 31 campos del quiz/match
Los mismos 30 de la Acción 0 del quiz (14 `cf_bici_*` + 10 hero/alt + `cf_otras` ·
`cf_match` · 3 `cf_q_*` · `cf_lead_id`) **+ `cf_modelo_texto`** (el portador de la
etiqueta de ruta). *(En DM no hay Acción 0 global: la limpieza vive al inicio de las
rutas que usan el match — esta y el QZ0 del quiz, que acá también borra los 31.)*

### A-3 · Condición: ¿`cf_modelo_buscado` está vacío?
- **Sí (vacío)** → tratar como **BICI_SUELTA** (Etapa 4). **NUNCA llamar a `mc-match`
  con el campo vacío.**
- **No** → A-4.

### A-4 · SE `mc-match` modo A — solicitud externa
```json
{
  "handle": "<Nombre de usuario>",
  "modelo": "{{cf_modelo_buscado}}",
  "origen": "Puerta 2 (DM)"
}
```
🚨 **`cf_modelo_buscado` (la salida 2 del AI Step), NUNCA `cf_mensaje`** — con el DM
completo («tienen la Levo SL?») el matching devuelve No-match teniendo la bici.
**Mapeo:** los mismos 13 pares del quiz (`$.match → cf_match` … `$.leadId → cf_lead_id`).

### A-5 · Condición `cf_match` es `true`
- **Sí** → **SE-F** (la ficha rica de la Etapa 2; el copy de B2-Q se reusa literal, y si
  `cf_otras` no está vacío, agregar esa línea tal cual — ya viene redactada).
- **No** → **NM-A** (paso propio, NO el copy de «se vendió»):
```
Te soy derecho: hoy no tenemos ninguna que calce con eso 🙈

Si es la que andabas buscando, te la conseguimos. Todas las semanas salimos a buscar modelos específicos para gente que nos los encarga.

¿Te contactamos con nuestro especialista para que te asesore?
```
| Botón | Destino |
|---|---|
| `Sí, que me llamen` | → B4 (directo) |
| `Ver lo que hay ahora` | → B2-C |

## Etapa 4 · Los códigos cortos

### BICI_SUELTA — paso de texto
```
¿Cuál de todas? 🚲 Mándame el nombre (Levo, Epic, Creo, Tarmac, Stumpjumper…) o pégame el link del video y te la ubico al toque.
```
| Botón | Destino |
|---|---|
| `Que me llamen mejor` | → B4 |
| `Ver lo que hay ahora` | → B2-C |

*Si en vez de botón escribe el modelo, el mensaje cae al Default Reply → vuelve a entrar
al enrutador → sale como MODELO. No cuenta golpe del anti-bucle.*

### CONTACTO — paso de texto → B4
```
Dale, te llamamos 🙌 Confírmame el número tal cual, para no equivocarnos.
```
→ **B4** (el paso de teléfono normal; NUNCA volcar el mensaje crudo en `cf_telefono`).
Antes de B4: setear `cf_modelo_texto` = `dio teléfono solo`.

### SALUDO — mensaje con los 3 botones del anti-bucle, SIN contar golpe
```
Hola 👋 Dime en qué te ayudo:
```
| Botón | Destino |
|---|---|
| `Busco una bici` | → BICI_SUELTA |
| `Ayúdenme a elegir` | → QZ0 (el quiz) |
| `Quiero vender` | → V-1 (VENDER) |

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
→ setear `cf_modelo_texto` = `VENDE: {{cf_v_modelo}} {{cf_v_anio}}` → **B4**.

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

### GARANTIA · PAGOS — fallback compartido (hasta que llegue el texto de Roberto)
```
Eso te lo explica mejor Luis en dos minutos que yo por acá 🙂

¿Te llamamos y de paso te resuelve todo lo demás?
```
Botones: `Sí, que me llamen` → B4 · `Por ahora no` → B7.
Antes de B4 en estas dos rutas: setear `cf_modelo_texto` = `POSTVENTA/FAQ`.
⚠️ **Los botones son obligatorios** — sin botón de flujo la pregunta queda retórica y el
lead muere ahí.

## Etapa 7 · El anti-bucle (`NO_CLASIFICA` y cualquier valor inesperado)

**Golpe 1** (`cf_no_reconocido` vacío): setear `cf_no_reconocido` = `1` → mensaje:
```
Puede que me haya perdido 🙈 Dime en qué te ayudo:
```
Botones: `Busco una bici` → BICI_SUELTA · `Ayúdenme a elegir` → QZ0 · `Quiero vender` → V-1.

**Golpe 2** (`cf_no_reconocido` = `1`): en este orden —
1. Setear `cf_modo_humano` = `si`.
2. **Acción nativa «Notificar a administradores»** (push/email de ManyChat): conversación
   varada con intención real; alguien la toma en la bandeja.
3. Mensaje:
```
Mejor te contesta una persona 🙂 Dame un rato y te escribo por acá.
```
4. **Cool-off (mejora 2026-07-30, pedida por Gabriel): Smart Delay de 24 h → borrar
   `cf_modo_humano` Y `cf_no_reconocido`.** El contacto vuelve solo al circuito automático
   al día siguiente, con los golpes reseteados — es además la regla original del pivote
   («el bot no retoma DENTRO de las 24 h», no «nunca»). Si Luis quiere silencio más largo,
   lo re-setea a mano.

⚠️ **NO usar la «Pausa de automatizaciones 24 h» nativa**: suspende también la regla de
baja (choque conocido, runbook §5.3).

## Etapa 8 · La entrada — el enrutador

### E-0 · Disparador: **CUALQUIER DM** (sin keywords)
+ **agregar el disparador de respuesta a historia** apuntando al mismo flujo (si no se
agrega, ese tráfico no enciende nada y no da error — §5.10.5).
⚠️ La regla de baja R1 ya existe (automatización aparte, de la puerta de comentarios) y
corre antes — **no recrearla**.

### E-1 · Condición: `cf_modo_humano` es `si` → **nada** (el bot se calla). Si no → E-2.

### E-2 · ¿El mensaje es audio / foto / sticker / post compartido? — respuesta propia, SIN contar golpe:
```
¿Me compartiste un video? 🚲 Dime el nombre de la bici que sale (Levo, Epic, Creo…) y te la ubico al toque. Lo mío es el texto 🙈
```
*(Copy 2026-07-30: cubre el caso frecuente del que comparte un reel por DM. **ManyChat NO
expone qué publicación compartieron** — sin texto, sin shortcode, sin URL — y no existe
disparador de «post compartido», así que no puede haber automatización tipo comentarios:
se le pide el nombre y su respuesta re-entra al enrutador como MODELO. Verificar en
pantalla cómo se detecta el tipo de mensaje; si el builder no distingue, esta rama queda
como fallback del AI Step.)*

### E-3 · Acción: guardar el mensaje en `cf_mensaje`
**ANTES del AI Step, no dentro de una ruta** — si se guarda solo en la ruta de modelo, en
el resto llega vacío o arrastrado del mensaje anterior.

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
| `VENDER` | → A-1' (mc-lead con canal DM IG) → V-1 |
| `CONTACTO` | → CONTACTO |
| `ENVIOS` | → ENVIOS |
| `GARANTIA` · `PAGOS` | → fallback GARANTIA/PAGOS |
| `VISITA` | → VISITA |
| `SALUDO` | → SALUDO |
| `NO_CLASIFICA` **y CUALQUIER OTRO VALOR (rama else)** | → anti-bucle |

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

## Go-live de la puerta (al activarla se completa el reemplazo de la V1)

Es el §9 del runbook: rotar `MC_KEY` (la `MC_KEY_V2` de `.dev.vars`) + redeploy +
actualizar la llave en TODAS las solicitudes externas · apagar las automatizaciones V1 ·
al día siguiente, borrar los 13 custom fields muertos. **Coordinar conmigo el redeploy.**
