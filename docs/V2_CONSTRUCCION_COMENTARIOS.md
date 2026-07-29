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
> primero que se monta. Al duplicar cambian 3 cosas (runbook §4): el post, las 10 keywords y
> el `reel` de los 2 bodies.

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
| `Tengo una consulta` | 18 | → C1b *(paso 17)* |

*El catch-all «escribe en vez de tocar» no se puede colgar de la respuesta privada: ese
texto cae al Default Reply y lo capturará la puerta de DM.*

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
3. **El link va como TEXTO, no como botón:**
```
Ficha completa con todas las fotos: {{cf_bici_ficha}}
```
Sin botones: de B2 se sale por el Smart Delay.

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

### Paso 6 · B4-L · Salida lateral — paso de texto, sin botones
```
Ningún problema 👌 Te dejo la ficha por acá y cualquier duda me escribes: {{cf_bici_ficha}}
```

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
*(La bandera ANTES que el mensaje: ese orden es la protección anti-duplicado.)*

### Paso 12 · C2 · El guard — condición
- `cf_oferta_enviada` **es** `si`
- **Sí** → **NADA** (sin destino: el flujo muere ahí a propósito)
- **Si no** → A1

### Paso 13 · D1 · Smart Delay — 40 segundos
Al vencer → **C2**. *(Tuneable; lo importante es la bandera, no el valor.)*

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
| `Ver lo que hay ahora` | 20 — límite exacto | → **C2** |

### Paso 19 · Reposicionar C1a — entre Acción 0 y B1
- `cf_bici_disponible` **es** `false` *(texto: el endpoint escribe la palabra)*
- **Sí** → B2-V · **Si no** → B1

⚠️ **Único paso que puede protestar** (pariente de la limitación de la respuesta privada).
Si el builder no acepta una condición entre las acciones y la respuesta privada, **fallback
= diseño anterior**: C1a vive después de B1 (botones de B1 → C1a; «Sí» → B2-V sin el
«Hola 👋»; «Si no» → C1b). Todo lo demás queda idéntico.

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
C1a  Sí → B2-V              · Si no → B1
B2-V Sí que me llamen → B4  · Ver lo que hay ahora → C2
B1   botones ×2 → C1b
C1b  Sí → B2-E              · Si no → B2
B2   → D1        B2-E → D1
D1   → C2
C2   Sí → (nada) · Si no → A1
A1   → B3
B3   Sí que me llamen → B4  · Por ahora no → B7
B4   válido → B5            · falla ×2 → B4-L
B5   Correcto → A2 → SE3 → C3 · Corregir → B4
C3   Sí → B6                · Si no → B6-D
```

### Publicar y probar
1. Publicar (Active) — vivo en ~5 min.
2. Comentar el post con **cuenta virgen** usando una de las 10 keywords.
3. Completar el viaje hasta B6 y verificar contra el E2E del runbook §8 (Lead con canal,
   Interés con `Reel`, ticket con brief, `Fecha teléfono` sellada, aviso a Luis, rama dedup).
4. Borrar los registros de prueba por id.
5. Recién entonces duplicar ×5 (runbook §4).
