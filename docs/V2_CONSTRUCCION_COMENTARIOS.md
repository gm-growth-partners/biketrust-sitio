# Hoja de construcción — Puerta de comentarios V2

> **Qué es esto.** El detalle técnico de CADA bloque de la automatización de comentarios,
> en el orden real de construcción (del final hacia el principio, para que cada cable
> encuentre su destino ya creado). Es la contraparte ejecutable del diseño del
> [`V2_RUNBOOK_MANYCHAT.md`](V2_RUNBOOK_MANYCHAT.md) §3, con el cambio de diseño del
> 2026-07-29: **C1a va ANTES de B1** (la bici vendida se confiesa de inmediato).
>
> **El mapa visual es [`embudo_comentarios_v2_bloques.svg`](embudo_comentarios_v2_bloques.svg)**
> — 23 bloques coloreados por tipo. Convención acordada con Gabriel: todo diseño futuro de
> automatización ManyChat se entrega con su diagrama de bloques así.
>
> Esta hoja está escrita para el **reel SL (`DbEh9fBI9Np`, Levo SL S-Works · M)**, que es el
> master. **Al duplicar cambian exactamente 4 elementos en 3 bloques** — tabla completa por
> reel en la sección «Duplicación por reel» al final.

Reglas transversales:
- **Todos los botones son «Ir a un paso» (flujo), NUNCA URL** — un botón URL no revive el
  hilo terminal ni abre la ventana de 24 h.
- `<MC_KEY>` = la llave vigente (está a la vista en el script de la automatización de
  Airtable «kanban a mensajes»). **No usar `MC_KEY_V2`** hasta el go-live.
- `<Nombre de usuario>` = el campo de sistema de Instagram, insertado desde el **selector**
  de ManyChat. Nunca tipeado como merge tag.

---

## Etapa 0 · Lo ya construido — verificar contra esto

### N0 · Disparador
- Tipo: Instagram → comentario en una publicación específica.
- Post: el del shortcode `DbEh9fBI9Np`.
- **10 palabras clave** (reparto del runbook §4, aplicado a este reel — ajustables):
  `sl` · `levo` · `levo sl` · `sworks` · `precio` · `valor` · `cuanto` · `$$$` ·
  `disponible` · `queda`
- ✅ «Enviar primer mensaje como respuesta privada» ACTIVADO.
- ⚠️ Enfriamiento anti-spam ~24 h por contacto y post (no configurable): **probar con
  cuenta virgen**.

### N1 · «Acción 0 — tracking invisible»
Tres pasos, en este orden exacto, ANTES de cualquier mensaje:

**1) Borrar valor** de los 14:
```
cf_bici_modelo · cf_bici_talla · cf_bici_puntaje · cf_bici_area_baja
cf_bici_estado_honesto · cf_bici_precio · cf_bici_precio_nuevo · cf_bici_ahorro
cf_bici_rango_altura · cf_bici_foto · cf_bici_ficha · cf_bici_disponible
cf_bici_bateria · cf_bici_ciclos
```
*(el mapeo de ManyChat NO limpia campos que llegan vacíos: sin este borrado se arrastra la
bici del lead anterior — la falla más silenciosa del sistema).*

**2) Solicitud externa `mc-lead`** — POST · `Content-Type: application/json`
```
https://biketrust-sitio.pages.dev/api/mc-lead?key=<MC_KEY>
```
```json
{ "handle": "<Nombre de usuario>", "canal": "Comentario IG" }
```
Sin mapeo de respuesta (el `leadId` lo trae `mc-evento`). ⚠️ No mandar `nombre` (llegaría el
literal `{{full_name}}`).

**3) Solicitud externa `mc-evento`** — POST · `Content-Type: application/json`
```
https://biketrust-sitio.pages.dev/api/mc-evento?key=<MC_KEY>
```
```json
{
  "handle": "<Nombre de usuario>",
  "estado": "ficha_entregada",
  "origen": "Puerta 1 (reel/comentario)",
  "resultado": "Ficha entregada",
  "reel": "DbEh9fBI9Np"
}
```
**Mapeo de respuesta (15 pares, rutas planas — nunca anidadas):**

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

### N2 · Respuesta pública
Delay ~3 s → una de **5 variantes rotadas, sin links**:
```
Te escribí al DM 📩
Te mandé el detalle por interno 📩
Al DM te llegó todo 📩
Revisa tu DM, te mandé la ficha 📩
Te escribí por interno 📩
```
A una agregarle: `Si no te aparece, míralo en Solicitudes de mensaje`.

### N3 · B1 · La oferta de la ficha *(construido — sus botones se cablean en el paso 17)*
Respuesta privada = **un solo bloque + botones** (limitación de plataforma; es terminal).
```
Hola 👋 Vi tu comentario en la {{cf_bici_modelo}}.

¿Quieres ver la ficha técnica con specs, precio y la nota que sacó en nuestra inspección?
```
| Botón | Chars | Destino |
|---|---|---|
| `Sí, muéstramela` | 15 | → C1b *(paso 17)* |
| `Tengo una consulta` | 18 | → **B1-Q** *(paso 17-bis — cambio 2026-07-29: iban los dos al mismo lugar)* |

*El catch-all «escribe en vez de tocar» no se puede colgar de la respuesta privada: ese
texto cae al Default Reply y lo capturará la puerta de DM.*

### Paso 17-bis · B1-Q + B1-W · El router de la consulta *(diseño de Gabriel, 2026-07-29)*

**B1-Q · ¿Bici o tienda? — paso de texto:**
```
Dime 🙂 ¿tu consulta es sobre esta bici o sobre la tienda?
```
| Botón | Chars | Destino |
|---|---|---|
| `Sobre la bici` | 13 | → C1b (la ficha responde; B3 llega solo a los 40 s) |
| `Sobre la tienda` | 15 | → B1-W |

**B1-W · La tienda — paso de texto, sin botones.** ⚠️ PROVISORIO: cuando exista la puerta
de DM, `Sobre la tienda` se re-apunta al enrutador de intención.
```
Estamos en Av. Las Condes 12461, Las Condes 📍 Lunes a viernes de 9:00 a 20:00, sábado de 10:00 a 14:00.

Y acá puedes ver todo lo que tenemos: https://biketrust.cl
```
Salida → **D1**: responde lo que preguntó y a los 40 s B3 le ofrece la llamada igual.

> **Mejora futura anotada (2ª iteración, NO hoy):** nutrición post-catálogo — preguntar al
> rato si le interesó algún modelo (a quien pasó por B2-C o B1-W). No es un bloque más: es
> un mini-ciclo de reenganche que necesita ventana abierta o plantilla de WhatsApp.

### N4 · B2 · La ficha *(construido — su salida se cablea en el paso 14)*
Paso normal (alcanzado por botón → sin límite de bloques). **3 burbujas:**
1. **Imagen** alimentada por `cf_bici_foto`
2. **Texto:**
```
{{cf_bici_modelo}} · Talla {{cf_bici_talla}}

Certificación: {{cf_bici_puntaje}}/7 🔧
Donde perdió puntos: {{cf_bici_area_baja}}

Estado honesto, tal cual está hoy:
{{cf_bici_estado_honesto}}

Nueva hoy sale {{cf_bici_precio_nuevo}}.
Esta queda en {{cf_bici_precio}} → te ahorras {{cf_bici_ahorro}}.
```
   ⚠️ **La línea «Donde perdió puntos» quedó pendiente de condicionar** (fix 2026-08-18):
   con desglose parejo (7/7 en las cuatro áreas) `mc-evento` devuelve `cf_bici_area_baja`
   **vacío a propósito** — antes nombraba la primera área y el DM decía «Donde perdió puntos:
   Cuadro y Estructura» de una bici impecable. Falta montar la variante en ManyChat:
   condición `cf_bici_area_baja` no vacío → bloque con la línea; vacío → sin ella.
3. **El link de la ficha** — *as-built 2026-07-30: quedó como botón «Ver Ficha» con URL
   **FIJA** (la ficha del reel de esa automatización), válido en paso normal (el botón URL
   no interfiere con el Next Step; la restricción de botones-URL era solo para B1)*.
   ⚠️ **Consecuencia: la URL del botón CAMBIA en cada duplicado** (en B2 y en B2-E) — es el
   5º elemento de la duplicación. Mejora pendiente de probar: poner `{{cf_bici_ficha}}` como
   URL del botón; si ManyChat acepta la variable ahí, este paso desaparece.

De B2 se sale por el Smart Delay (Next Step), no por el botón.

### N5 · C1a *(construida — se reposiciona en el paso 19)*

---

## Etapa 1 · Los finales (nada depende de ellos)

### Paso 1 · B7 · Salida blanda — paso de texto, sin botones, sin siguiente paso
```
Dale, sin problema 👌 Cero llamadas.

Cualquier duda me escribes por acá. Y si alguien la aparta antes, te aviso.
```

### Paso 2 · B6 · Confirmación — paso de texto, sin botones
El número va **tipeado tal cual** (no es variable):
```
Listo ✅ Te va a llamar Luis Sulbarán, nuestro especialista, {{cf_promesa}}.

Te marca desde el +56 9 2181 5855 — guarda el número así sabes que somos nosotros 😉

Si no te pilla, te deja un WhatsApp a ese mismo número.
```

### Paso 3 · B6-D · Confirmación dedup — paso de texto, sin botones
```
Listo ✅ Ya tenía tu solicitud anotada — Luis te llama en cuanto pueda.

Te marca desde el +56 9 2181 5855 — guarda el número así sabes que somos nosotros 😉

Si no te pilla, te deja un WhatsApp a ese mismo número.
```
⚠️ La última línea no se saca de ninguno de los dos: declara el permiso del ciclo
«No contestado».

---

## Etapa 2 · El cierre telefónico

### Paso 4 · C3 · «¿Hubo promesa?» — condición
- `cf_promesa` **tiene algún valor** (no está vacío)
- **Sí** → B6 · **Si no** → B6-D

### Paso 5 · A2 + SE3 · El backend
En secuencia:
1. **Acción → Borrar valor** de `cf_promesa` *(obligatorio: hace funcionar C3 — si la
   respuesta no trae promesa, el campo queda vacío en vez de arrastrar el valor de otra
   corrida)*
2. **Solicitud externa `mc-llamado`** — POST · `Content-Type: application/json`
```
https://biketrust-sitio.pages.dev/api/mc-llamado?key=<MC_KEY>
```
```json
{
  "handle": "<Nombre de usuario>",
  "telefono": "{{cf_telefono}}",
  "reel": "DbEh9fBI9Np",
  "notas": "Puerta 1 · dijo: {{cf_mensaje}}"
}
```
   ⚠️ **Sin `optin`** (el teléfono solo ya activa el opt-in) · **sin `ciudad` ni `franja`**
   (la ubicación la pregunta Luis).
   Mapeo de respuesta: `$.promesaLlamada` → `cf_promesa`
   *(este request además dispara solo el aviso `nuevo_llamado` a Luis)*
3. Salida → **C3**

### Paso 6 · ~~B4-L~~ ELIMINADO — el reintento vive DENTRO del paso de teléfono
*(Realidad de plataforma verificada en pantalla, 2026-07-29: el paso de entrada de teléfono
NO permite acciones ni ramas tras los intentos fallidos — solo un mensaje de reintento.
B4-L se eliminó del canvas; no crear ningún bloque.)*

El único mecanismo es el **mensaje de reintento** configurado dentro del propio B4:
```
Creo que se cortó un dígito 🙈 ¿me lo mandas de nuevo? Así sirve: 9 1234 5678
```
Tras ~3 intentos fallidos el flujo termina en silencio. Mitigación: si la persona escribe
el número a mano, cae en la bandeja — **revisar la bandeja es rutina operativa** hasta que
exista la puerta de DM.

### Paso 7 · B4 · El teléfono — entrada de usuario
- Tipo de respuesta: **Teléfono** → guardar en `cf_telefono`
- ✅ **«Guardar como ID de WhatsApp»** (lo necesita el motor de recordatorios)
- Pregunta:
```
Perfecto 🙌 ¿A qué número te llamamos?

Escríbelo como quieras (9 1234 5678, +569…, da lo mismo).
```
- Reintento (máximo 2; si la pantalla no expone el conteo, usar la rama de respuesta no
  válida / skip):
```
Creo que se cortó un dígito 🙈 ¿me lo mandas de nuevo? Así sirve: 9 1234 5678
```
- Rama fallo/skip → **B4-L** · rama válida → *pendiente hasta el paso 9*

### Paso 8 · B5 · El eco — paso de texto
```
Anotado: {{cf_telefono}} ✅
```
| Botón | Chars | Destino |
|---|---|---|
| `Correcto` | 8 | → A2 |
| `Corregir` | 8 | → B4 |

### Paso 9 · Cerrar el pendiente
Volver a **B4** y conectar su rama de respuesta válida → **B5**. *(Único cable diferido del
montaje: B4 y B5 se referencian mutuamente.)*

---

## Etapa 3 · La oferta de llamada

### Paso 10 · B3 · Oferta — paso de texto
```
¿Te gustaría hablar directamente con un especialista por teléfono para orientarte mejor?

Te resuelve las dudas que por chat no se responden bien: si esa talla te calza, el historial completo de la unidad, y cómo la despachamos si estás fuera de Santiago.
```
| Botón | Chars | Destino |
|---|---|---|
| `Sí, que me llamen` | 17 | → B4 |
| `Por ahora no` | 12 | → B7 |

### Paso 11 · A1 · Marcar oferta — acción set field
`cf_oferta_enviada` = `si` → siguiente paso: **B3**.

### Paso 12 · ~~C2 · El guard~~ — **ELIMINADO (2026-07-30, decisión Gabriel)**
> En el as-built B3 tiene **una sola vía de entrada** (D1): el catch-all que motivaba el
> anti-duplicado no se pudo montar (el texto libre cae al Default Reply). Lo único que C2
> hacía en la práctica era **matar en silencio al contacto que volvía por segunda vez**
> (`cf_oferta_enviada` es por contacto y persiste). Se quitó de TODAS las automatizaciones
> de comentarios y del quiz. A1 se conserva: la marca es la señal de la guarda C-OFERTA de
> la puerta de DM (que no corta: manda a B4).

### Paso 13 · D1 · Smart Delay — 40 segundos
Al vencer → **A1** (directo; sin C2).

---

## Etapa 4 · Las fichas

### Paso 14 · Conectar B2 → **D1**

### Paso 15 · B2-E · Ficha e-bike — duplicar B2
En la burbuja de texto, insertar **entre el estado honesto y las líneas de precio**:
```
Diagnóstico de batería: {{cf_bici_bateria}}% de salud · {{cf_bici_ciclos}} ciclos.
Regla nuestra: bajo 80% no la vendemos.
```
Salida → **D1**.

### Paso 16 · C1b · «¿Es eléctrica?» — condición
- `cf_bici_bateria` **tiene algún valor** (no está vacío)
- **Sí** → B2-E · **Si no** → B2
*(No es una lista de modelos: lo decide el dato de la bici en Airtable, reel por reel. Con
4 musculares Disponibles hoy —Epic 8 Pro incluida, el reel #1— esta rama es obligatoria.)*

### Paso 17 · Re-apuntar B1
Sus 2 botones → **C1b**.

---

## Etapa 5 · La bifurcación de entrada (cambio de diseño 2026-07-29)

### Paso 18 · B2-V · Bici vendida — paso nuevo
Ahora es **primer mensaje** en su rama, por eso saluda. Una burbuja + 2 botones:
```
Hola 👋 Te soy derecho: esa unidad ya se vendió. El video sigue dando vueltas 🙈

Pero si es la que andabas buscando, te la conseguimos. Todas las semanas salimos a buscar modelos específicos para gente que nos los encarga.

¿Te contactamos con nuestro especialista para que te asesore?
```
| Botón | Chars | Destino |
|---|---|---|
| `Sí, que me llamen` | 17 | → **B4** (se salta B3) |
| `Ver lo que hay ahora` | 20 — límite exacto | → **B2-C** *(cambio 2026-07-29: pedía ver el stock y se le ofrecía una llamada — pregunta una cosa, respondíamos otra)* |

### Paso 18-bis · B2-C · Catálogo — paso de texto, sin botones
```
Acá puedes ver todo lo que tenemos disponible ahora mismo 👉 https://biketrust.cl

Todas pasaron por nuestra inspección, con su nota de 1 a 7 a la vista.
```
Salida → **D1** (la misma Pausa): valor → 40 s mirando el catálogo → C2 → B3 ofrece la
llamada. Responde lo que pidió Y converge igual.

> **Dos decisiones revisadas y RATIFICADAS el mismo día (no re-abrir):**
> - **`Tengo una consulta` → C1b → B2 se queda.** La ficha responde la mayoría de las
>   consultas, y para el resto la salida llega sola: D1 → B3 («te resuelve las dudas que por
>   chat no se responden bien»). El Q&A real por chat es trabajo de la puerta de DM.
> - **B4-L se queda en la rama de fallo del teléfono.** Quien llega ahí QUIERE la llamada
>   (tocó «Sí, que me llamen» e intentó dos veces): mandarle B7 («Cero llamadas») sería
>   responderle al revés. B4-L cierra con valor y deja la puerta abierta; si escribe su
>   número a mano, abre la ventana de 24 h y cae en la bandeja.

### Paso 19 · Reposicionar C1a — entre Acción 0 y B1
- `cf_bici_disponible` **es** `false` *(texto: el endpoint escribe la palabra)*
- **Sí** → B2-V · **Si no** → B1

> ✅ **CONFIRMADO EN PANTALLA (2026-07-29): el builder SÍ acepta la condición entre las
> acciones y la respuesta privada.** C1a quedó antes de B1 y el fallback no fue necesario.
> Cada rama tiene su propia respuesta privada (B2-V o B1).

*Beneficio lateral: si `mc-evento` fallara y los campos llegaran vacíos, «es false» no calza
y cae al camino normal (B1).*

---

## Etapa 6 · Fuera del flujo

### Paso 20 · R1 · Regla de baja — AUTOMATIZACIÓN APARTE
Corre antes que cualquier flujo, venga el mensaje de donde venga.
- Disparador de palabras clave en DM:
```
stop · baja · no me escribas · no me escriban · no me molesten · sácame · sacame · unsubscribe · no quiero · déjenme
```
- Acciones en orden: tag `baja_voluntaria` → **Unsubscribe** nativo → mensaje único:
```
Listo, no te escribimos más 👌
```
Sin más pasos. Nunca intenta recuperar.

---

## Etapa 7 · Cierre

### Paso 21 · Checklist de conexiones
```
Acción 0 → C1a
C1a  Sí → B2-V                 · Si no → B1
B2-V Sí que me llamen → B4     · Ver lo que hay ahora → B2-C
B2-C → D1
B1   Sí, muéstramela → C1b     · Tengo una consulta → B1-Q
B1-Q Sobre la bici → C1b       · Sobre la tienda → B1-W
B1-W → D1
C1b  Sí → B2-E                 · Si no → B2
B2   → D1        B2-E → D1
D1   → A1        (C2 eliminado 2026-07-30)
A1   → B3
B3   Sí que me llamen → B4     · Por ahora no → B7
B4   válido → B5               · reintento interno (sin rama de fallo: límite de plataforma)
B5   Correcto → A2 → SE3 → C3  · Corregir → B4
C3   Sí (con valor) → B6       · Si no (vacío) → B6-D
```

### Publicar y probar
1. Publicar (Active) — vivo en ~5 min.
2. Comentar el post con **cuenta virgen** usando una de las 10 keywords.
3. Completar el viaje hasta B6 y verificar contra el E2E del runbook §8 (Lead con canal,
   Interés con `Reel`, ticket con brief, `Fecha teléfono` sellada, aviso a Luis, rama dedup).
4. Borrar los registros de prueba por id.
5. Recién entonces duplicar (sección siguiente).

---

## Duplicación por reel — los 4 elementos que cambian

| # | Bloque | Elemento | Cómo queda |
|---|---|---|---|
| 1 | Disparador | El post vinculado | El reel elegido |
| 2 | Disparador | Las 10 palabras clave | Las del reel (tabla abajo) |
| 3 | «Acción 0» → Solicitud externa `mc-evento` | `"reel"` en el body | El shortcode del reel |
| 4 | «A2 + SE3» → Solicitud externa `mc-llamado` | `"reel"` en el body | El mismo shortcode |
| 5 | **B2** → botón «Ver Ficha» | URL de destino | La ficha de ESE reel (tabla abajo) |
| 6 | **B2-E** → botón «Ver Ficha» | URL de destino | La misma ficha |

**Nada más se toca**: URLs, `handle`, mapeos, copy y condicionales son idénticos — la bici
correcta la trae `mc-evento` desde Airtable usando el shortcode.

| Reel | Shortcode | Bici | URL del botón «Ver Ficha» | 10 keywords |
|---|---|---|---|---|
| SL (master) | `DbEh9fBI9Np` | Levo SL S-Works · M | `https://biketrust-sitio.pages.dev/ficha/levo-sl-s-works-m` | sl · levo · levo sl · sworks · precio · valor · cuanto · $$$ · disponible · queda |
| Epic 8 Pro | `DbCLcpEB4aT` | Epic 8 Pro · L | `https://biketrust-sitio.pages.dev/ficha/epic-8-pro-l` | epic · epic 8 · epica · pro · precio · valor · cuanto · $$$ · disponible · queda |
| Creo SL | `DbQjdNLBmnv` | Creo SL S-Works · M | `https://biketrust-sitio.pages.dev/ficha/creo-sl-s-works-m` | creo · creo sl · sl · sworks · precio · valor · cuanto · $$$ · disponible · queda |
| Levo SL2 | `Dad9A_zJy0D` | Levo SL2 S-Works · S4 | `https://biketrust-sitio.pages.dev/ficha/levo-sl2-s-works-s4` | levo · sl2 · levo sl · sworks · precio · valor · cuanto · $$$ · disponible · queda |
| Levo 4G | `DZ1O3ViO2Qz` | Levo 4G S-Works · S4 | `https://biketrust-sitio.pages.dev/ficha/levo-4g-s-works-s4` | levo · 4g · levo 4g · sworks · precio · valor · cuanto · $$$ · disponible · queda |

Al activar cada duplicado: **pausar la automatización V1 de ESE post** (colisionan) y hacer
el smoke test — comentar con cuenta virgen y verificar que **B1 nombre la bici correcta**
(el error clásico es dejar el shortcode del post anterior; el único síntoma es la bici
equivocada).

⚠️ El reel 6 «Ruta» (`DbJy7ynB5T4`) queda FUERA: su fila de `Reels` no tiene bici a
propósito (deriva a asesoría), B1 imprimiría el modelo vacío y la Tarmac ya se vendió.
Necesita variante propia — segunda pasada, junto con la puerta de DM.
