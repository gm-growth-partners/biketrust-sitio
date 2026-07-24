# Bike Trust · Reconstrucción de la capa ManyChat (v2)

> Documento de **decisión + hallazgos verificados** de la sesión del **2026-07-24**.
> Complementa a [`EMBUDO.md`](EMBUDO.md) (diseño del embudo) y a [`CLAUDE.md`](CLAUDE.md)
> (memoria viva). Idioma: español.
>
> Motivo: se decidió **borrar toda la capa de automatizaciones de ManyChat** (flows y
> custom fields) y reconstruirla desde cero sobre el sistema v2, **sin tocar el backend**
> (Pages Functions + Airtable). Este archivo existe para que la reconstrucción no rompa
> lo que hoy funciona y para dejar registrado lo que se descubrió leyendo el código.

**Leyenda:** ✅ verificado leyendo el código · 📄 documentado en el repo (no re-verificado) · ⚠️ riesgo · 🔧 pendiente

---

## 0. La decisión

Se reconstruye **solo la capa de presentación** (ManyChat). El backend es el sistema y
queda intacto: los 7 puentes `mc-*`, los crons, Airtable y el sitio.

Motivo: la capa de ManyChat creció orgánicamente entre Puerta 1 y Puerta 2 y es más
barato rehacerla ordenada que auditarla flujo por flujo. El backend, en cambio, está
verificado E2E y no tiene deuda que justifique tocarlo.

---

## 1. ⚠️ CHECKLIST OBLIGATORIO ANTES DE BORRAR

Esto es lo único de este documento que, si se ignora, rompe producción **en silencio**.

### 1.1 Cinco custom fields se recrean con nombre literal idéntico

El backend los escribe por **string** vía la API de ManyChat (`setCustomFieldByName`).
Si el campo no existe, la llamada lanza error, el mensaje no sale, y el fallo queda en
un JSON de respuesta que nadie mira.

| Campo | Quién lo escribe | Para qué |
|---|---|---|
| `cf_bici` | `cron-recordatorios.js` ✅ | Variable `{{1}}` de las plantillas WhatsApp (modelo de la bici) |
| `cf_fecha_visita` | `cron-recordatorios.js` ✅ | Variable `{{2}}` (fecha legible en 48h; solo hora en 8am/2h) |
| `cf_consigna_datos` | `mc-consigna.js` 📄 | Resumen de la consignación al staff |
| `cf_solicitud_datos` | `mc-waitlist.js` 📄 | Resumen del ticket de búsqueda al staff |
| `cf_llamado_datos` | `mc-llamado.js` 📄 | Resumen del llamado de región al staff |

Referencia exacta en `cron-recordatorios.js`:

```js
await mcSetField(C.MC_TOKEN, sid, 'cf_bici', bici);
await mcSetField(C.MC_TOKEN, sid, 'cf_fecha_visita', cfFecha);
await mcSendFlow(C.MC_TOKEN, sid, flowNs);
```

### 1.2 No borrar los flows que envuelven plantillas de WhatsApp

Sus **namespaces** están en variables de entorno de Cloudflare Pages. Si se recrean, el
`flow_ns` cambia y hay que actualizar cada variable a mano:

`FLOW_NS_48H` · `FLOW_NS_8AM` · `FLOW_NS_2H` · `FLOW_NS_CONSIGNA` · `FLOW_NS_SOLICITUD` ·
`FLOW_NS_LLAMADO` · `FLOW_NS_REAGENDO` · `FLOW_NS_NOSHOW` · `FLOW_NS_SUELTO`

Las plantillas están aprobadas por Meta; re-aprobar cuesta días.

### 1.3 Filtrar Leads con `Fecha visita` futura antes de borrar

Esa gente ya agendó y espera confirmación y recordatorio. Si el borrado ocurre dentro de
esa ventana, se caen sin aviso. **Si hay visitas agendadas para los próximos días, el
borrado se posterga.**

### 1.4 Lo que sobrevive

Los subscriber ids son **contactos**, no flujos: Luis `579628082`, Roberto `302195575`.
También sobreviven `Leads.MC subscriber id` en Airtable y las plantillas aprobadas.

### 1.5 Después de reconstruir

1. Actualizar todos los `FLOW_NS_*` en Cloudflare Pages si se recrearon los envoltorios.
2. Correr `cron-recordatorios` con `?dry=1` y confirmar que no hay `errors`.
3. **Rotar `MC_KEY`** (quedó expuesta en un transcript de chat) y actualizar el `?key=`
   de todas las Solicitudes externas.

---

## 2. ✅ Hallazgos sobre `mc-match.js` (leídos del código, no documentados antes)

### 2.1 La respuesta es PLANA, y es a propósito

El endpoint devuelve, además de los objetos anidados, un bloque de campos de primer
nivel. El comentario del código lo explica: se hicieron así porque **la UI de ManyChat
no siempre lee bien las rutas anidadas** (`$.hero.fichaUrl`).

**Usar siempre estos en el mapeo de respuesta:**

```
heroModelo · heroPrecio · heroTalla · heroFicha · heroBici · heroFoto
altModelo  · altPrecio  · altFicha  · altBici
otrasTexto · modeloBuscado · match · waitlist
```

`otrasTexto` viene listo para pegar en el DM cuando el modo A devuelve varias
coincidencias, así que ManyChat **no necesita botones dinámicos** para desambiguar.

### 2.2 ⚠️ En modo quiz SIEMPRE devuelve un `hero` si hay al menos una bici Disponible

No hay umbral de puntaje. El código toma `ranked[0]` aunque el score sea negativo:

```js
if (disponibles.length) {
  const ranked = rankDisponibles(disponibles, crit);
  hero = biciView(C, ranked[0].b);          // sin umbral
  if (ranked[1] && ranked[1].s > 0) alternativa = biciView(C, ranked[1].b);
} else { waitlist = true; }
```

**Consecuencia en producción:** `no_match` en modo quiz solo se dispara con el inventario
Disponible vacío. Alguien que responde "ruta, hasta $3M, 1,60 m" recibe igual una MTB
S-Works talla L a varios millones, presentada como recomendación.

**Mitigación sin tocar código (la adoptada):** el copy no afirma calce ("de lo que tengo
en stock ahora, la que más se acerca es…") y el botón de salida honesta («No es lo que
busco» → `mc-waitlist`) va **siempre visible** en el mensaje de recomendación, no
escondido en una rama que nunca ocurre.

**Mejora futura 🔧:** umbral de score mínimo en `mc-match` modo B para devolver `no_match`
de verdad. Es un cambio chico y convierte la mitigación de copy en lógica real.

### 2.3 Pesos del scoring (todos blandos, nada bloquea)

| Criterio | Efecto |
|---|---|
| Disciplina | +40 si calza |
| Motorización | +30 si calza |
| Presupuesto | +20 decreciente si está dentro; hasta −25 si lo supera |
| Altura vs `Rango altura` | +12 dentro (tolerancia 2 cm), −8 fuera, **0 si la bici no declara rango** |
| Talla explícita | +10 |

La disciplina pesa más que todo lo demás. Si el catálogo es homogéneo en disciplina, esa
pregunta del quiz no discrimina y conviene sacarla.

### 2.4 Tolerancias de parseo (no hace falta normalizar en ManyChat)

- **Selects:** compara con `norm()` (minúsculas, sin tildes, sin signos). `Eléctrica` y
  `electrica` calzan igual. Lo que **sí** rompe es usar otra palabra (`Ruta` vs `Carretera`).
- **Presupuesto:** `"Hasta $3 millones"`, `"3000000"`, `"$3.000.000"` → 3.000.000.
  `"Sin límite"` no tiene dígitos → `null` → no filtra.
- **Altura:** `"1,75"`, `"1.75"`, `"175"`, `"175 cm"` → metros. Fuera de 1,2–2,2 → `null`.
  Merge tags sin resolver (`{{…}}`) → `null`.
- **Talla:** **no se manda**; la asigna el endpoint cruzando altura contra `Rango altura`.

### 2.5 Orden de llamadas que importa

`mc-lead` va **antes** que `mc-match`. Si `mc-match` corre primero y el lead no existe, lo
crea con `Canal origen = Quiz` (default del endpoint) y se pierde la atribución al reel.
Por la misma razón, en flujos de Puerta 1 hay que pasar `origen` explícito
(`"Puerta 1 (reel/comentario)"`), o el Interés queda marcado como Puerta 2.

---

## 3. Hoja de custom fields para la reconstrucción (33)

Todos tipo **texto**.

| Grupo | Campos |
|---|---|
| **A · Obligatorios backend** (§1.1, nombre literal) | `cf_bici` `cf_fecha_visita` `cf_consigna_datos` `cf_solicitud_datos` `cf_llamado_datos` |
| **B · Identidad** | `cf_lead_id` `cf_estado_aplicado` `cf_telefono` |
| **C · Bici recomendada** (calzan 1:1 con §2.1) | `cf_hero_bici` `cf_hero_modelo` `cf_hero_precio` `cf_hero_talla` `cf_hero_ficha` `cf_hero_foto` `cf_alt_bici` `cf_alt_modelo` `cf_alt_precio` `cf_alt_ficha` `cf_otras_texto` `cf_match` `cf_modelo_buscado` |
| **D · Quiz** | `cf_q_motor` `cf_q_disciplina` `cf_q_presupuesto` `cf_q_altura` |
| **E · Modelo en texto libre** | `cf_modelo_texto` |
| **F · Región** | `cf_ciudad` `cf_franja` |
| **G · Consignación** | `cf_v_modelo` `cf_v_anio` `cf_v_talla` `cf_v_estado` `cf_v_precio` `cf_v_fotos` |
| **H · Tickets devueltos** | `cf_solicitud_id` `cf_llamado_id` `cf_consigna_id` |

⚠️ El grupo C se **borra al inicio de cada corrida** (acción "borrar valor"), antes de
llamar a `mc-match`. El mapeo de respuesta no limpia campos con valores vacíos, así que
sin ese borrado se arrastra la bici del lead anterior. Ya está documentado como gotcha en
`EMBUDO.md` §4.2; acá se repite porque es la falla más silenciosa del sistema.

---

## 4. Inventario de automatizaciones a construir (16)

**Entradas (triggers)**

1. Comentario en reel (una por post; ManyChat no expone el Post ID comentado)
2. DM directo → router
3. Respuesta a historia → router
4. Keywords de baja → opt-out
5. Default reply → fallback

**Contenido**

6. Router de bienvenida
7. Modelo específico (`mc-match` modo A)
8. Desambiguación multi-opción (usa `otrasTexto`, sin botones dinámicos)
9. Quiz (`mc-match` modo B)
10. Ficha y recomendación
11. Tronco de agendamiento (región → teléfono → slot → `mc-agenda`)
12. Rama región (`mc-llamado`)
13. Consíganmela (`mc-waitlist`)
14. Vender (`mc-consigna`)
15. FAQ
16. Opt-out

**Envoltorios de plantilla WhatsApp:** no se rehacen (§1.2).

---

## 5. Evaluación: ¿PDF adjunto en vez de link a la ficha?

**Conclusión: link para la ficha por bici, PDF solo para material que no caduca.**

- Instagram habilita adjuntos y ManyChat tiene bloque de archivo (feb 2026), pero el
  envío **dinámico por API/bloque dinámico no está soportado** en los canales de
  Instagram ni WhatsApp. Solo se manda un archivo **estático subido al flow**.
- Para mandar el PDF de la bici recomendada habría que subir un archivo por unidad y
  ramificar por bici. Contradice el principio del sistema (la operación vive en Airtable,
  no en ManyChat).
- Un PDF **se congela**: dice el precio y la disponibilidad del día en que se envió. Con
  inventario que rota, es prometer stock que puede no existir.
- Un PDF **es terminal**: la ficha web lleva el flujo de reserva encima; el PDF no.

**Uso recomendado 🔧:** un único PDF estático de "Cómo certificamos", en el FAQ y entre el
agendamiento y la visita. No depende de la bici, no caduca, y ataca la objeción principal
de una Specialized usada premium.

---

## 6. ⚠️ Desfase entre el árbol de decisiones v2.4 y producción

El artefacto `biketrust_arbol_decisiones_v2_4.html` (auditoría de 19 hallazgos, cerrada
el 2026-07-24) fue diseñado sobre supuestos que **ya no describen este sistema**. Antes de
usarlo como plano de construcción hay que reconciliarlo. Choques detectados:

| El árbol dice | La realidad |
|---|---|
| El matching del quiz es la dependencia dura de P0, "sin eso el quiz no entrega" | `mc-match` en vivo desde 2026-07-08, verificado 21/21; recomienda por estatura desde el 07-09 |
| Cuatro External Request contra la base de inventario | Siete Pages Functions propias con `MC_KEY`, guarda de no-regresión y retry-429 |
| Convergencia = tronco → **handoff humano a Luis** con timer de SLA y fallback | El rediseño del 2026-07-01 **eliminó** el cerrador humano en el agendamiento: agenda-en-el-chat + recordatorios WhatsApp; el humano solo cierra en tienda |
| Salida "venta ganada" como salida del embudo | Decisión 2026-07-20: el embudo llega **hasta show/no-show**; la venta la registra Ailoo |
| Puerta 2 "por construir" | En vivo con router, 3 rutas de compra, Consíganmela y Vender |
| Diccionario de modelos como componente nuevo | `mc-match` modo A ya hace matching tolerante a typos (Levenshtein por token) desde el 07-18 |

**Lo que del árbol sí sirve:** su doctrina y su disciplina de copy. Fue esa disciplina la
que llevó a encontrar §2.2, que es un hallazgo sobre producción, no sobre un diseño.

**Pendiente 🔧:** pasada de reconciliación pieza por pieza (ya vivo / falta de verdad /
contradice lo vivo). Estimación preliminar de lo genuinamente pendiente: FAQ real, reel
evergreen, Puerta 3 (respuesta a historia), opt-out, y la secuencia `Conseguida` → cliente.

---

## 7. Errata de documentación detectada

- **Inventario:** son **12** bicis, no ~14. La cifra vieja aparece en `EMBUDO.md` §6 y en
  un comentario de `mc-match.js`.
- ⚠️ **La vista `Grid view` de Inventario está filtrada por `Interesados`** y muestra 4
  registros. No es el inventario. Para contar o inspeccionar, usar la vista `Disponibles`
  o la API. (Este error se cometió en esta sesión y llevó a una conclusión equivocada.)
- `CLAUDE.md` §1 todavía describe el funnel como "diseñado, aún sin construir", mientras
  §2 lo marca EN VIVO.

**Regla de trabajo que sale de esto:** inventario, esquema y opciones de campo se
consultan a la base por API, **nunca** a la documentación. La documentación describe
decisiones; la base describe el estado.

---

## 8. Referencias

- [`EMBUDO.md`](EMBUDO.md): diseño del embudo, contratos de los endpoints (§5), gotchas de IG/ManyChat (§4.2)
- [`CLAUDE.md`](CLAUDE.md): estado, modelo de datos, errores ya cometidos
- [`functions/api/mc-match.js`](functions/api/mc-match.js): fuente de §2
- [`functions/api/cron-recordatorios.js`](functions/api/cron-recordatorios.js): fuente de §1.1
