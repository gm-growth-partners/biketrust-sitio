# Montaje · Flujo de WhatsApp entrante

> Diagrama: [`flujo_whatsapp_entrante.svg`](flujo_whatsapp_entrante.svg)
> Todo lo del lado servidor está construido, desplegado y probado. Esto es solo el
> montaje en ManyChat.

**Base:** `https://biketrust-sitio.pages.dev` · **Clave:** la misma `MC_KEY` que ya usan
las otras Solicitudes externas · **Todas** son `POST` con `Content-Type: application/json`.

⚠️ En WhatsApp **no existe `{{ig_username}}`**. El identificador es siempre
**`{{user_id}}`** → campo `subscriber_id`.

---

## Paso 1 · Disparador y clasificación

Disparador: **mensaje nuevo** en el canal de WhatsApp.

Condición sobre `{{last_input}}`, en este orden:

| Si contiene | Rama | `canal` |
|---|---|---|
| `ficha certificada` | **FICHA** | `Web` |
| `quiero encargar` | ENCARGO | `Web` |
| `quiero consignar` | CONSIGNA | `Web` |
| `Busco una Specialized` | GENERAL | `Web` |
| *(nada de lo anterior)* | LIBRE | `WhatsApp` |

## Paso 2 · El lead nace con su canal — en las 5 ramas

```
POST /api/mc-lead?key=<MC_KEY>
{ "subscriber_id": "{{user_id}}", "canal": "<el de la tabla>", "nombre": "{{first_name}} {{last_name}}" }
```

🔴 **Sin esto la persona cuenta en la puerta equivocada** y la Puerta 3 sigue en cero.

---

## Rama FICHA — la cadena larga

### 3 · Resolver la bici

Extraer el número de `(ref 4082552)` del mensaje → guardarlo en `cf_ref`.

```
POST /api/mc-bici?key=<MC_KEY>
{ "ref": "{{cf_ref}}" }
```

Mapear la respuesta a campos: `bici` → `cf_bici_id` · `modelo` → `cf_modelo` ·
`precio_texto` → `cf_precio` · `puntaje` → `cf_puntaje` · `ficha_url` → `cf_ficha_url` ·
`disponible` → `cf_disponible`.

### 4 · Guarda de disponibilidad

**Si `cf_disponible` es falso → NO mandar la ficha.** Avisar que se vendió y ofrecer
buscar algo parecido (deriva a la rama ENCARGO). Sin esta guarda alguien recibe la ficha
de una bici que ya no está.

### 5 · Mandar la ficha

Mensaje con `{{cf_ficha_url}}` + puntaje, precio y rango de altura.

### 6 · Registrar que se entregó

```
POST /api/mc-evento?key=<MC_KEY>
{ "subscriber_id": "{{user_id}}", "estado": "ficha_entregada",
  "resultado": "Ficha entregada", "origen": "Web (ficha)", "bici": "{{cf_bici_id}}" }
```

### 7 · «¿Quieres que un experto te llame?»

**Rama SÍ** — primero el sello, después el teléfono:

```
POST /api/mc-acepta?key=<MC_KEY>
{ "subscriber_id": "{{user_id}}" }
```

⚠️ **En este orden.** Si se sella después de pedir el número, quien acepta y no lo deja
desaparece — y esa es exactamente la fuga que se quiere ver.

Luego: entrada **tipo teléfono** → `cf_telefono` (✅ «Guardar como ID de WhatsApp») →

```
POST /api/mc-llamado?key=<MC_KEY>
{ "subscriber_id": "{{user_id}}", "telefono": "{{cf_telefono}}", "optin": true,
  "ciudad": "{{cf_ciudad}}", "bici": "{{cf_bici_id}}" }
```

**Rama NO** — cierre suave. El lead ya quedó registrado con su ficha entregada.

---

## Ramas ENCARGO · CONSIGNA · GENERAL — cortan en el teléfono

Las tres hacen lo mismo y en este orden:

1. Entrada **tipo teléfono** → `cf_telefono`
2. `POST /api/mc-llamado` (igual que arriba, sin `bici`)
3. **Recién ahí** las preguntas específicas:
   - **ENCARGO** → modelo, talla, presupuesto → `POST /api/mc-waitlist`
   - **CONSIGNA** → modelo, año, estado, precio esperado → `POST /api/mc-consigna`
   - **GENERAL** → nada más; queda en la cola de Luis

**Por qué el teléfono primero:** el ticket de llamada entra a la cola de inmediato y Luis
puede llamar aunque la persona abandone a mitad del cuestionario. Al revés se pierden las
dos cosas.

---

## Rama LIBRE

```
POST /api/mc-clasifica?key=<MC_KEY>
{ "mensaje": "{{last_input}}" }
```

Devuelve `intencion` → mapear a `cf_intencion` y reusar la cascada del DM, que ya existe.

---

## Prueba de humo (hazla tú mismo antes de dejarlo vivo)

1. Entra al sitio, abre una ficha, aprieta **«Recibir la ficha por WhatsApp»**.
2. Sigue el flujo y di que **sí** a la llamada. Deja tu número.
3. Verifica:

| Dónde | Qué debe estar |
|---|---|
| `Leads` | `Canal origen = Web` · `Fecha aceptó llamada` con hora · `Aceptó llamada = 1` · `Fecha teléfono` |
| `Intereses` | fila con `Resultado = Ficha entregada`, `Origen = Web (ficha)` y **la bici enlazada** |
| `Llamados` | ticket en `Llamada pendiente` con tu teléfono y la bici |
| Tablero → Puertas → Sitio web | las 6 etapas con números |

4. **Márcate `DEMO` en Leads e Intereses** o quedas contado como lead real.
5. Repite apretando **«Encargo»** para comprobar que esa rama corta en el teléfono.

⚠️ Marcar `DEMO` en el Lead **no se propaga al Interés**. Hay que marcarlo en ambos.
