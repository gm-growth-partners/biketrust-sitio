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

## 0.5 ⚠️ PIVOTE DE DISEÑO (2026-07-27) — intención en vez de menú

Decisión de Gabriel tras la primera semana con tráfico real (S30: 31 leads, 27 fichas
entregadas, **0 visitas agendadas**, 5 DMs libres varados en `nuevo`):

1. **Sin menú de bienvenida.** La persona escribe como habla; el bot **reconoce la
   intención** del mensaje y rutea directo. **4 rutas**: modelo específico · asesoría/elegir
   (quiz) · vender su bici · pregunta general.
2. **Toda ruta converge en una agenda.** La conversación no termina en información,
   termina en una fecha. La **ubicación decide el cierre**: Santiago → visita
   (`mc-agenda`) · región → llamada del equipo (`mc-llamado`). Esto aplica también a
   la ruta *vender* (tasación con fecha) y a *pregunta general*.
3. **Sin handoff humano en el chat.** Muere el «te conecto con una persona» como
   salida de diseño; el humano entra en la visita o la llamada agendada. (Puede quedar
   una válvula mínima de escalamiento para bordes, sin promesas de tiempo de respuesta.)

**Especificación de montaje:** [`docs/cuaderno_montaje_biketrust.html`](docs/cuaderno_montaje_biketrust.html)
(hojas de flujo bloque a bloque, copys, JSON de cada solicitud externa, esquema de campos).
**Investigación de respaldo:** [`docs/biketrust_arbol_decisiones_v2_4.html`](docs/biketrust_arbol_decisiones_v2_4.html)
(benchmark CarMax/Kavak/TPC + validación contra 175 DMs reales + bordes B01–B12).
**Ambos se leen con la fe de erratas del §0.7** — tienen ideas previas al pivote.

## 0.6 Plan de implementación — 3 días

| Día | Qué | Detalle |
|---|---|---|
| **D1 · Cimientos** | demoler + fundar | Checklist §1 completo (hoy no hay visitas agendadas en ventana → vía libre) · recrear los 33–34 custom fields (los 5 literales del §1.1 primero) · **rotar `MC_KEY` AL INICIO** y montar toda solicitud externa ya con la llave nueva · entradas: 6 automatizaciones de reel (cada una enviando su **shortcode** en `reel`), DM directo, historias, keywords de baja, default reply |
| **D2 · La conversación** | intención + rutas | Clasificador de intención (**verificar ANTES que el plan de ManyChat incluya AI Intents; si no, re-decidir, no degradar en silencio**) · 4 rutas · convergencia única de agenda con fork por ubicación · FAQ · opt-out |
| **D3 · Pruebas y salida** | E2E + go-live | Viaje completo real por cada intención (comentario y DM) · verificar cada escritura en Airtable y tablero (§7 de `EMBUDO.md` como criterio de aceptación) · `cron-recordatorios?dry=1` sin errores · salida en vivo + monitoreo |

Acompañan (código, no ManyChat): umbral de no-match en `mc-match` modo B (§2.2) ·
ManyChat emite `quiz_iniciado` · hora exacta en `Llamados` · semana en curso en el tablero.

**La operación de Luis (2026-07-27):** [`docs/V2_OPERACION_KANBAN.md`](docs/V2_OPERACION_KANBAN.md)
— una sola pantalla tipo Kanban sobre `Llamados`, agrupada por `Salida`. **Arrastrar la
tarjeta es marcar la salida es disparar el mensaje**: un gesto, sin segundo paso que olvidar.
Los dueños ven el mismo Kanban en modo lectura.

**Insumos del D1 listos (2026-07-27):** [`docs/V2_DIA1_INSUMOS.md`](docs/V2_DIA1_INSUMOS.md)
— runbook ordenado, hoja definitiva de **44** campos (conteo real; los «33/34» eran erróneos),
las 9 entradas con sus shortcodes y bodies JSON, decisiones abiertas y verificación de cierre.
La `MC_KEY` nueva está generada en `.dev.vars` (`MC_KEY_V2`, gitignored — nunca al repo).

## 0.7 Fe de erratas de los documentos de diseño (leer antes de montar)

Del **cuaderno de montaje** (`docs/cuaderno_montaje_biketrust.html`):
- **SPK-vender NO converge** («ya le pasé todo al equipo») → en V2 vender también agenda (visita de tasación o llamada según ubicación).
- **HANDOFF con asignación a Luis** → reducirlo a válvula mínima de borde, sin promesas de tiempos.
- Sus **6 intenciones informativas** (envíos/pagos/garantía/ubicación) viven agrupadas bajo la ruta *pregunta general* del pivote (pueden ser sub-clasificación interna).
- «Rotar MC_KEY al terminar» → se rota **al inicio** (D1).
- Dice «Levenshtein por token» → el matching real ya es **por bigramas** (2026-07-27).
- Inventario declara 22 flujos / 34 campos → **cuadrar contra lo montado** en D1 (las entradas de comentario son 6, una por reel vivo).
- SPK-quiz bloques 7/8: numeración de saltos con error — revisar al montar.

Del **árbol v2.4** (`docs/biketrust_arbol_decisiones_v2_4.html`) — además del desfase del §6:
- «Base sincronizada con Ailoo» como contrato de datos → el contrato vigente es **Airtable vía las Pages Functions** (Ailoo es integración futura).
- «EL PASO QUE FALTA: matching» → el matching **existe y está verificado**; lo fino es el umbral de no-match.
- «Modo degradado por Ailoo» → eliminado; sobrevive solo el principio «la promesa del front nunca excede la capacidad del back».
- Menú de bienvenida de 3 botones + handoff con SLA y brief → supersedidos por el pivote (§0.5).
- Tres salidas de agendamiento (visita/llamada/**apartado**) → convergencia por ubicación; el apartado queda como idea futura.
- **Lo que SÍ se rescata tal cual:** los 4 arcos por nodo de input, «cero resultados nunca es callejón», el fallback instrumentado (`modelo_no_reconocido` + revisión semanal), la captura temprana de ubicación, los bordes B01–B12, el vocabulario minado del tráfico real y el opt-out evaluado antes que todo.

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

## 4. Inventario de automatizaciones a construir (actualizado al pivote §0.5)

> El detalle bloque a bloque vive en `docs/cuaderno_montaje_biketrust.html` (con la fe
> de erratas del §0.7). Este es el esqueleto:

**Entradas (triggers) — diminutas, sin lógica**

1. Comentario en reel ×6 (una por post vivo; cada una manda su **shortcode** en `reel` — ManyChat no expone el Post ID comentado)
2. DM directo → clasificador de intención
3. Respuesta a historia → mismo clasificador
4. Keywords de baja → opt-out (evaluadas ANTES que todo)
5. Default reply → fallback instrumentado (tag `modelo_no_reconocido` + revisión semanal)

**Rutas (spokes) — la sustancia**

6. ~~Router de bienvenida con menú~~ → **Clasificador de intención** (4 rutas; el precio NO es intención, es modificador)
7. Modelo específico (`mc-match` modo A, bigramas)
8. Desambiguación multi-opción (usa `otrasTexto`, sin botones dinámicos; nunca elegir por el lead)
9. Asesoría/elegir = quiz (`mc-match` modo B; emite `quiz_iniciado` al partir)
10. Ficha y recomendación (borrar grupo C de campos ANTES de cada mc-match)
11. **Convergencia de agenda** (única, invocada por todas las rutas): ubicación → Santiago `mc-agenda` · región `mc-llamado`
12. Vender (`mc-consigna`) → **también converge en agenda** (tasación con fecha)
13. Consíganmela (`mc-waitlist`) — «cero resultados nunca es callejón»
14. Pregunta general (FAQ; sub-clasifica envíos/pagos/garantía/ubicación) → cierra ofreciendo agenda
15. Opt-out
16. Válvula mínima de escalamiento (bordes; sin promesas de tiempo)

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
