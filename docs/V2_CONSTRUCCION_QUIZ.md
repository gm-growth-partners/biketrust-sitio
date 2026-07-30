# Hoja de construcción — Quiz V2 (reels sin bici + ruta ASESORIA del DM)

> **Qué es esto.** El detalle técnico de CADA bloque de la automatización de quiz, en el
> orden real de construcción (del final hacia el principio, igual que
> [`V2_CONSTRUCCION_COMENTARIOS.md`](V2_CONSTRUCCION_COMENTARIOS.md)). Cubre: los **reels
> sin bici específica** (Ruta y testimonio), el **catch-all del catálogo viejo** y la
> **ruta `ASESORIA` de la puerta de DM**, que reusa estos mismos bloques.
>
> **El mapa visual es [`embudo_quiz_v2_bloques.svg`](embudo_quiz_v2_bloques.svg)** —
> misma convención de colores que el de comentarios.
>
> **Decisión de Gabriel 2026-07-30 (supersede runbook §0-bis.7 y la 1ª mitad de §5.5):**
> el quiz SÍ entra en esta pasada, porque sus dos prerrequisitos quedaron cumplidos hoy:
> 1. **`mc-match` modo B tiene UMBRAL** — bajo el corte devuelve `match=false` honesto en
>    vez de recomendar cualquier bici (el corte es el 35 % del puntaje alcanzable con los
>    criterios entregados; quiz completo ≈ 25 puntos). Test offline: `test/mc-match-quiz.mjs`.
> 2. **`mc-match` acepta `reel`** — el Interés del quiz queda atribuido al video de origen
>    (sin esto, cada lead de estos reels era un huérfano de atribución en el tablero).
>
> ⚠️ **BLOQUEANTE: estos dos cambios deben estar DESPLEGADOS antes de probar E2E.**
> Sin el deploy, el quiz «matchea» siempre y el Interés nace sin `Reel`.

Reglas transversales (idénticas a la hoja de comentarios):
- Botones **«Ir a un paso» (flujo), NUNCA URL** — salvo los links que van como texto.
- `<MC_KEY>` = la llave vigente (visible en el script de «kanban a mensajes»). **No usar
  `MC_KEY_V2`** hasta el go-live.
- `<Nombre de usuario>` = campo de sistema de Instagram desde el **selector**. Nunca tipeado.
- Esta hoja está escrita para el **reel Ruta (`DbJy7ynB5T4`)**, que es el master del quiz.
  Tabla de duplicación al final.

## Los 4 candados del copy (runbook §5.5 — obligatorios, no adornos)

1. **Prohibido afirmar calce.** Única formulación: *«la que más se acerca a lo tuyo»*.
2. **No prometer la talla** — `heroTalla` es el dato de Airtable, no un cálculo desde la
   estatura. Siempre: *«la talla exacta se confirma contigo»*.
3. **No decir «se ajusta a tu presupuesto»** — el scoring premia acercarse al techo.
4. **La salida honesta existe de verdad**: con el umbral, `cf_match = false` es una rama
   real y su copy dice «ninguna calza bien», nunca «esa se vendió» (runbook §5.4).

## Custom fields — **no se crea ninguno nuevo**

Todos existen (son parte de los 54): `cf_q_disc` · `cf_q_presup` · `cf_q_altura` ·
`cf_hero_bici` · `cf_hero_modelo` · `cf_hero_talla` · `cf_hero_precio` · `cf_hero_ficha` ·
`cf_hero_foto` · `cf_alt_bici` · `cf_alt_modelo` · `cf_alt_precio` · `cf_alt_ficha` ·
`cf_otras` · `cf_match` · `cf_lead_id` + los 14 `cf_bici_*` + `cf_telefono` · `cf_promesa` ·
`cf_oferta_enviada`.

---

## Etapa 1 · Los finales (idénticos a la hoja de comentarios)

Construir igual que allá (mismos copys, mismos botones): **B7** (salida blanda) ·
**B6** y **B6-D** (confirmaciones, con el +56 9 2181 5855 tipeado) · **C3** (¿hubo promesa?).

## Etapa 2 · El cierre telefónico

### Paso 4 · A2 + SE3 · El backend — ⚠️ 2 diferencias con la hoja de comentarios
1. **Acción → Borrar valor** de `cf_promesa`.
2. **Solicitud externa `mc-llamado`** — POST · `Content-Type: application/json`
```
https://biketrust-sitio.pages.dev/api/mc-llamado?key=<MC_KEY>
```
```json
{
  "handle": "<Nombre de usuario>",
  "telefono": "{{cf_telefono}}",
  "bici": "{{cf_hero_bici}}",
  "reel": "DbJy7ynB5T4",
  "notas": "Puerta 1 · quiz: {{cf_q_disc}} · presup {{cf_q_presup}} · mide {{cf_q_altura}}"
}
```
   - ⚠️ **`bici` = el HERO del quiz, no la bici del reel** — la fila `Reels` de este post
     no tiene bici a propósito. Con `bici` poblada el ticket llega CON brief (puntaje,
     rango, precio, estado). En la rama no-match `cf_hero_bici` va vacío → el endpoint cae
     al `reel` → sin bici → ticket sin brief, que es lo correcto (no hay unidad concreta).
   - Sin `optin` · sin `ciudad` ni `franja` (la ubicación la pregunta Luis).
   - Mapeo de respuesta: `$.promesaLlamada` → `cf_promesa` → salida a **C3**.

### Pasos 5–7 · B4 · B5 — idénticos a la hoja de comentarios
Entrada tipo teléfono → `cf_telefono` · ✅ «Guardar como ID de WhatsApp» · reintento
interno · B5 eco (`Correcto` → A2 · `Corregir` → B4).

## Etapa 3 · La oferta de llamada — idéntica

**B3** (oferta, `Sí, que me llamen` → B4 · `Por ahora no` → B7) · **A1**
(`cf_oferta_enviada` = `si` → B3) · **C2** (guard: `si` → nada · si no → A1) ·
**D1** (Smart Delay 40 s → C2).

## Etapa 4 · Los resultados del quiz

### Paso 8 · B2-C · Catálogo — idéntico a la hoja de comentarios
```
Acá puedes ver todo lo que tenemos disponible ahora mismo 👉 https://biketrust.cl

Todas pasaron por nuestra inspección, con su nota de 1 a 7 a la vista.
```
Salida → **D1**.

### Paso 9 · NM · Salida honesta (no-match) — paso nuevo
```
Te soy derecho: de lo que tengo HOY, ninguna calza bien con lo que me dijiste 🙈

Pero si sabes lo que buscas, te la conseguimos. Todas las semanas salimos a buscar modelos específicos para gente que nos los encarga.

¿Te contactamos con nuestro especialista para que te asesore?
```
| Botón | Chars | Destino |
|---|---|---|
| `Sí, que me llamen` | 17 | → **B4** (directo, se salta B3) |
| `Ver lo que hay ahora` | 20 — límite exacto | → B2-C |

*Nunca el copy de «esa unidad ya se vendió»: acá no hay ninguna unidad (runbook §5.4).*

### Paso 10 · B2-ALT · La alternativa — paso de texto, sin botones
```
También te podría servir: {{cf_alt_modelo}} · {{cf_alt_precio}}
{{cf_alt_ficha}}
```
Salida → **D1**.

### Paso 11 · C-ALT · ¿Hay alternativa? — condición
- `cf_alt_modelo` **tiene algún valor** → B2-ALT · si no → **D1**.

### Paso 12 · B2-Q · La ficha del hero — 4 burbujas
1. **Texto (el candado de honestidad):**
```
De lo que tengo disponible HOY, la que más se acerca a lo tuyo es esta 👇

La talla exacta se confirma contigo — Luis te lo dice al teléfono según tu estatura.
```
2. **Imagen** alimentada por `cf_bici_foto`.
3. **Texto:** el MISMO copy de B2 de la hoja de comentarios (modelo · talla · certificación ·
   dónde perdió puntos · estado honesto · precio nuevo/precio/ahorro).
4. **El link como TEXTO** (no botón URL — acá la bici cambia por lead, no por automatización):
```
Ficha completa con todas las fotos: {{cf_bici_ficha}}
```
Salida → **C-ALT**.

### Paso 13 · B2-QE · Ficha e-bike — duplicar B2-Q
Insertar entre el estado honesto y el precio (mismo texto del master):
```
Diagnóstico de batería: {{cf_bici_bateria}}% de salud · {{cf_bici_ciclos}} ciclos.
Regla nuestra: bajo 80% no la vendemos.
```
Salida → **C-ALT**.

### Paso 14 · C1b-Q · ¿Es eléctrica? — condición
- `cf_bici_bateria` **tiene algún valor** → B2-QE · si no → B2-Q.

### Paso 15 · SE-F · La ficha rica — solicitud externa `mc-evento`
```
https://biketrust-sitio.pages.dev/api/mc-evento?key=<MC_KEY>
```
```json
{ "lead": "{{cf_lead_id}}", "bici": "{{cf_hero_bici}}", "soloEstado": true }
```
Con `soloEstado: true` no crea Interés (ya lo creó `mc-match`) y, al no mandar `estado`,
no mueve el Estado del Lead. **Mapeo: los mismos 15 pares planos de la hoja de comentarios**
(`$.biciModelo` → `cf_bici_modelo` … `$.leadId` → `cf_lead_id`). Salida → **C1b-Q**.

### Paso 16 · C-Q · ¿Hubo match? — condición
- `cf_match` **es** `true` *(texto: el endpoint escribe la palabra)*
- **Sí** → SE-F · **Si no** → NM.

## Etapa 5 · El quiz

### Paso 17 · SE-Q · El motor — solicitud externa `mc-match`
```
https://biketrust-sitio.pages.dev/api/mc-match?key=<MC_KEY>
```
```json
{
  "handle": "<Nombre de usuario>",
  "disciplina": "{{cf_q_disc}}",
  "presupuesto": "{{cf_q_presup}}",
  "altura": "{{cf_q_altura}}",
  "origen": "Puerta 1 (quiz reel)",
  "reel": "DbJy7ynB5T4"
}
```
- El endpoint tolera texto libre en presupuesto («3,5 millones») y estatura («175», «1,75»).
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

Salida → **C-Q**.

### Paso 18 · QZ3 · Estatura — entrada de usuario (texto) → `cf_q_altura`
```
3/3 · ¿Cuánto mides? 📏

(1,75 o 175, como te acomode)
```
Respuesta válida → SE-Q.

### Paso 19 · QZ2 · Presupuesto — entrada de usuario (texto) → `cf_q_presup`
```
2/3 · ¿En cuánto anda tu presupuesto? 💸

Escríbelo como quieras: 3.500.000 · 3,5 millones · «flexible», da lo mismo.
```
Respuesta válida → QZ3.

### Paso 20 · QZ1 · Uso — mensaje con 3 botones
```
1/3 · ¿En qué vas a andar? 🚵
```
| Botón | Acción al tocar | Destino |
|---|---|---|
| `MTB / cerro` | set `cf_q_disc` = `MTB` | → QZ2 |
| `Ruta` | set `cf_q_disc` = `Ruta` | → QZ2 |
| `Ciudad` | set `cf_q_disc` = `Urbana` | → QZ2 |

⚠️ Los valores son **los literales del select `Disciplina` de Airtable** (`MTB` · `Ruta` ·
`Urbana`) — el matching compara por igualdad normalizada. Si el builder no permite acción
en el botón, crear 3 mini-acciones (QZ1a/b/c) que setean el campo y siguen a QZ2.

### Paso 21 · QZ0 · Marcar inicio — solicitud externa `mc-evento`
```json
{ "handle": "<Nombre de usuario>", "estado": "quiz_iniciado", "soloEstado": true }
```
Sin mapeo. Avanza el Estado a `quiz_iniciado` sin crear Interés — es lo que le da al
tablero la tasa de abandono del cuestionario (A3·instrumentación). Salida → **QZ1**.

## Etapa 6 · La entrada

### Paso 22 · B1-G · Primer DM — respuesta privada, TERMINAL
```
Hola 👋 Vi tu comentario. En este video no hay una sola bici protagonista — mejor te ayudo a encontrar la tuya.

¿Te hago 3 preguntas cortas y te muestro la que más se acerca a lo que buscas?
```
| Botón | Chars | Destino |
|---|---|---|
| `Sí, dale` | 8 | → QZ0 |
| `Ver lo que hay ahora` | 20 — límite exacto | → B2-C |

*El que escribe en vez de tocar cae al Default Reply → lo captura la puerta de DM.*

### Paso 23 · G2 · Respuesta pública
Delay ~3 s → las mismas 5 variantes rotadas de la hoja de comentarios.

### Paso 24 · G1 · «Acción 0 — tracking invisible» — ANTES de cualquier mensaje
1. **Borrar valor** de los **17 campos del quiz**: los 14 `cf_bici_*` + `cf_hero_bici` …
   `cf_hero_foto` (6) + `cf_alt_*` (4) + `cf_otras` + `cf_match` + `cf_q_disc` +
   `cf_q_presup` + `cf_q_altura`. *(Son 29 borrados en total con los 14 `cf_bici_*`; el
   mapeo de ManyChat no limpia campos vacíos — misma falla silenciosa de siempre.)*
2. **Solicitud externa `mc-lead`**:
```json
{ "handle": "<Nombre de usuario>", "canal": "Comentario IG" }
```
*(Acá NO va `mc-evento` con ficha: no hay ficha que registrar. El evento del quiz lo
emiten QZ0 y `mc-match`.)*

### Paso 25 · G0 · Disparador
- Comentario en el post `DbJy7ynB5T4` («Ruta»).
- ✅ «Enviar primer mensaje como respuesta privada».
- **10 keywords:** `ruta` · `tarmac` · `creo` · `precio` · `valor` · `cuanto` · `$$$` ·
  `disponible` · `queda` · `cual`

---

## Checklist de conexiones

```
G0 → G1 → G2 → B1-G
B1-G  Sí, dale → QZ0            · Ver lo que hay ahora → B2-C
QZ0 → QZ1 → (botón setea cf_q_disc) → QZ2 → QZ3 → SE-Q → C-Q
C-Q   Sí (true) → SE-F          · Si no → NM
SE-F → C1b-Q
C1b-Q Sí → B2-QE                · Si no → B2-Q
B2-Q / B2-QE → C-ALT
C-ALT Sí → B2-ALT → D1          · Si no → D1
NM    Sí que me llamen → B4     · Ver lo que hay ahora → B2-C
B2-C → D1
D1 → C2 · C2 Sí → (nada) · Si no → A1 → B3
B3    Sí que me llamen → B4     · Por ahora no → B7
B4 válido → B5 · B5 Correcto → A2 → SE3 → C3 · Corregir → B4
C3    Sí → B6 · Si no → B6-D
```

## Prueba E2E (con cuenta virgen, y con el deploy de mc-match EN VIVO)

1. Comentar el post con una keyword → B1-G llega.
2. `Sí, dale` → **Airtable: Lead `Estado = quiz_iniciado`** y `Cuestionario iniciado` ✓
   (lo marca la automatización A3).
3. Responder algo que calce (ej. MTB · 8 millones · 1,75) → ficha del hero con foto,
   puntaje y ahorro poblados + la línea de alternativa si corresponde.
4. **Interés: `Resultado = Match` · `Es hero` ✓ · `Crit·*` poblados · `Reel` = la fila
   del post** ← la atribución nueva; si `Reel` está vacío, el deploy no está en vivo o el
   `reel` del body está mal.
5. Con OTRA cuenta virgen: responder algo sin calce (ej. Ruta · 1 millón · 1,90) →
   **NM llega (no una bici forzada)** y el Interés nace `No-match` con `Reel`.
6. Dar el teléfono → ticket en `Llamados` con **bici = el hero** y el brief poblado ·
   `Leads.Fecha teléfono` sellada · aviso `nuevo_llamado` a Luis.
7. Borrar los registros de prueba por id.

---

## Duplicación — testimonio y catch-all

### Testimonio `DatyQVJuTFT` (fila en `Reels` lista, sin bici)
Cambian **3 elementos**: el post del disparador · las 10 keywords · el `reel` en el body
de **SE-Q y SE3** (los dos).
- Keywords sugeridas: `bici` · `precio` · `valor` · `cuanto` · `$$$` · `disponible` ·
  `queda` · `info` · `quiero` · `donde`

### Catch-all del catálogo viejo — CON COMPUERTA, no activar a ciegas
- Disparador: comentario en **cualquier publicación**, **cualquier palabra** (any-word).
- Mismos bloques, con 2 diferencias: **sin `reel`** en SE-Q ni SE3 (no se sabe el post →
  se acepta la pérdida de atribución) y `origen`: `"Puerta 1 (catch-all)"`.
- **La prueba del doble disparo ANTES de dejarla activa:** con el catch-all activo,
  comentar (cuenta virgen) un post que YA tiene automatización específica (ej. el SL) →
  si llegan **2 DMs**, colisiona: apagar el catch-all y hacer duplicados selectivos por
  post viejo. Si llega solo el DM de la específica, ManyChat prioriza bien y puede quedar.

### Ruta `ASESORIA` de la puerta de DM (reuso — decisión 2026-07-30)
En la automatización de DM, `ASESORIA` ya **no** va a B3: va a **QZ0 → … (los mismos
bloques, reconstruidos en ese canvas)**, con 3 diferencias:
1. **Sin `reel`** en SE-Q y SE3 (no hay post de origen).
2. **Sin `origen`** en SE-Q → el endpoint pone el default `Puerta 2 (quiz)`.
3. **Guarda 1 del runbook §5.4-bis:** si `cf_oferta_enviada` = `si`, la salida de la ficha
   va a **B4** en vez de B3 (ya recibió la oferta; falta solo el número).
