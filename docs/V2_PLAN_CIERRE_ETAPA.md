# Plan de cierre — Etapa Embudo V2

> Definido por Gabriel el 2026-07-30 (madrugada), con la puerta de comentarios recién
> en producción. **Estos 5 ítems, en este orden, cierran la etapa** — el 5 incluido
> (decisión de Gabriel: no se saca a etapa aparte).

**Punto de partida:** 4 automatizaciones V2 LIVE (Levo SL master · Epic 8 Pro · Creo ·
Levo 4G), E2E verificado contra Airtable, registros de prueba limpios. Falta el duplicado
de la Levo SL2 (queda dentro del ítem 2).

---

## ✔️ CHECKLIST DE CIERRE — estado 2026-08-04 (el mapeo completo pedido por Gabriel)

> Ítems 1 y 2: OPERATIVOS con flecos. Ítem 3: CONSTRUIDO, en pruebas. Esta lista es la
> foto exacta de lo que falta, en el orden en que conviene hacerlo.

**A · Cerrar la puerta de DM (bloquea todo lo demás):**
- [x] ~~Protocolo E2E pruebas 1–7~~ ✅ 2026-08-04 — rastro auditado en Airtable (Interés
      #278 Levo SL exacta · #279 quiz Kenevo · notas por ruta · dedup sumando al ticket).
- [ ] **E2E pruebas 8–13** + repetir la 6 limpia (sin borrar el contacto a mitad de un
      paso de captura — el paso queda armado, gotcha conocido). La 13 al final, con
      cuenta desechable.
- [ ] **Construir R1 · regla de baja** — NO existía (el doc la daba por hecha; cazado en
      el E2E). Spec en `V2_CONSTRUCCION_DM.md` § E-0: keywords EXACTOS para palabras
      sueltas (`baja` en «contiene» daría de baja a quien pregunta por una re**baja**),
      mensaje ANTES del unsubscribe. La prueba 13 valida su precedencia.
- [ ] **Sistema de avisos `aviso_equipo` — plantilla APROBADA por Meta (2026-08-04),
      falta construirlo:** (1) Gabriel: flujo envoltorio de 1 nodo WhatsApp con la
      plantilla, `{{1}}` bindeado a `cf_aviso_datos` (crear el campo, tipo texto) ·
      (2) Gabriel: env `FLOW_NS_AVISO_EQUIPO` = namespace del envoltorio (+ opcional
      `AVISO_EQUIPO_SIDS = 579628082,302195575`) · (3) Claude: **redeploy** · (4) probar
      con un mensaje sin sentido → debe llegar el WhatsApp a Luis y quedar la fila en
      `Avisos` con «WhatsApp enviado» ✓.

**B · Airtable — detalles para que las pantallas operen como deben:**
- [ ] Pantalla «2 · Visitas»: agregar **«Fecha y hora de visita»** (dispara la
      confirmación) y **«Bicis para la visita»** al panel de detalle · **ocultar
      `Franja`** (legado V1: el bot ya no la pregunta).
- [ ] Mostrar **`Atiende`** en las tarjetas del Kanban y en el detalle de Llamados
      (los campos existen desde 2026-07-30; falta exponerlos — alimentan la gestión
      por persona del tablero).
- [ ] **Prueba de humo de las 5 salidas del Kanban con mensajes reales** (nunca se hizo
      completa; exige ticket creado por el bot, no manual).

**C · Flecos de la puerta de comentarios (ítem 2):**
- [ ] Duplicado **Levo SL2** (6 elementos).
- [ ] Pegar el **copy nuevo de B3** en las automatizaciones de comentarios/quiz.
- [ ] **Quitar C2** donde siga montado (decisión 2026-07-30: B3 con vía única).

**D · Higiene de datos (antes del go-live, para no ensuciar métricas):**
- [ ] Borrar los registros de prueba del 04-08: leads `@_cmposunlocked`,
      `@_s.campos_`, `@domingaescandon` + sus tickets/avisos + el ticket de ensayo de
      `@_.matamala` en Visitas.
- [ ] Operativo Luis: llamar a los 3 teléfonos capturados por el **puente provisorio**
      (Springmuller · Concha · Ayala — prometido «en minutos» hace días) y al ticket de
      `@carlosbriceno._`.

**E · Entrega de la etapa:**
- [ ] **Pasada completa de COPYS de todas las puertas** (pedido explícito 2026-07-31;
      B3 renovado = el estándar). Hallazgos del E2E que entran en esta pasada:
      **ficha con intro por puerta** (portador `cf_ficha_intro`: MODELO ≠ quiz; versión
      fina exige bandera `heroExacto` en `mc-match`) · **C-2 se acorta** a «Dale, te
      llamamos 🙌» (hoy pide confirmar el número y B4 lo vuelve a pedir — redundante).
- [ ] **Corregir `Estrategia/V2/guia_sistema_biketrust.html`** (el doc de presentación
      a los dueños) — 4 afirmaciones hoy falsas: pinta como corriendo los 3 rescates
      APAGADOS (recordatorio 2 h · no-show · reenganche 3 días — envs V1 sin flujo) ·
      «llegó la bici encargada» NO es aviso automático (lo llama Luis) · cuenta la Levo
      SL2 dentro de los 5 reels (son 4, el duplicado está pendiente) · «máximo 2
      reintentos» en el teléfono no existe.
- [ ] **GO-LIVE formal** (runbook §9): apagar las automatizaciones DM de V1 → rotar
      `MC_KEY` (la `MC_KEY_V2` de `.dev.vars`; actualizar `?key=` en TODAS las
      solicitudes externas) → rotar también el PAT de Airtable → al día siguiente,
      borrar los 13 custom fields muertos.

**F · Después del cierre (no bloquea, no olvidar):**
- Gran doc (ítem 4) · **tablero con roles (ítem 5)** — ahí entran las mejoras de tablero
  que Gabriel quiere, consumiendo `Atiende` y la tabla `Avisos` · costura **Ailoo**
  (las bicis del puente provisorio no tienen ficha sin esto) · envs de rescate V1
  apagadas (`FLOW_NS_2H` / `NOSHOW` / `SUELTO` + flujo propio para `BUSCANDO`) ·
  binding `AI` para la capa IA de `mc-clasifica` · dominio `biketrust.cl` + `SITE_URL`.

---

## 1 · Cerrar Airtable + guía a Luis  ← SE EMPIEZA ACÁ (2026-07-30 AM)

El embudo ya mete leads; Luis opera de inmediato. Contiene:

- **Rediseño de la interfaz de Llamados**: mecanismo claro de agendamiento de visita
  (hoy son dos gestos poco evidentes: arrastrar en pantalla 1 + acordarse de completar
  fecha/bicis en pantalla 2 — y sin fecha la confirmación no sale), **creación manual de
  llamados/visitas** (hoy los tickets solo nacen del bot: el lead telefónico o walk-in no
  tiene puerta de entrada), y reorden de las opciones de `Salida` (el Kanban ordena por el
  orden del select; `Llamada pendiente` debe ir primera).
- **Las 2 plantillas Meta** `region_gestionando` y `llamada_no_contestada` (copy listo en
  runbook §6) + flujos envoltorio + envs `FLOW_NS_REGION` / `FLOW_NS_NO_CONTESTA` +
  redeploy. Sin esto, 2 de las 5 salidas del Kanban no despachan mensaje.
- **Guía a Luis**: 1 página por rol (estilo guion de llamada) + el diagrama de dueños
  (`embudo_comentarios_v2_para_duenos.svg`).

Reparto: Claude diseña/construye interfaz y guía (con OK de Gabriel); Gabriel las
plantillas en Meta y las envs en Cloudflare.

## 2 · Embudo para reels sin bici específica — **AHORA CON QUIZ (decisión 2026-07-30)**

> Gabriel decidió que estos reels hacen el **quiz** (uso · presupuesto · estatura) y
> muestran la ficha de la bici que más se acerca, antes de rutear a la llamada. Los dos
> prerrequisitos del runbook §5.5 quedaron cumplidos el mismo día: **umbral en `mc-match`
> modo B** (bajo el corte → no-match honesto) y **atribución por `reel` en `mc-match`**.
> ⚠️ Ambos exigen **deploy antes de probar E2E**.
> **La hoja de construcción es [`V2_CONSTRUCCION_QUIZ.md`](V2_CONSTRUCCION_QUIZ.md)**
> (+ diagrama `embudo_quiz_v2_bloques.svg`).

- Duplicado **Levo SL2** pendiente (6 elementos — ver guía de construcción de comentarios).
- **Quiz master en el reel «Ruta»** (`DbJy7ynB5T4`): B1-G → QZ0–QZ3 → `mc-match` modo B →
  ficha rica del hero → convergencia en la llamada. Salida honesta real en no-match.
- **Catch-all any-word** para el catálogo viejo, CON compuerta: **probar el doble disparo**
  (¿la automatización de "cualquier post" colisiona con las específicas?). Si colisiona →
  duplicados selectivos por post en vez de catch-all. Sin `reel` (atribución se pierde, aceptado).
- Incluye el testimonio `DatyQVJuTFT` (fila en `Reels` lista, sin bici).

## 3 · Puerta de DM con placeholders

- Diseño CERRADO en runbook §5 (AI Step enrutador, 2 campos listos para pegar).
- Placeholders asumidos: los 4 textos de Roberto (Grupo D lanza con fallback).
  ~~El quiz fuera~~ → **ACTUALIZADO 2026-07-30: `ASESORIA` va al quiz** (los prerrequisitos
  se cumplieron; ver ítem 2 y el final de `V2_CONSTRUCCION_QUIZ.md`).
- Las 4 verificaciones de pantalla del §5.10 (salida del AI Step · precedencia de la baja ·
  AI Step mudo · encolamiento).
- **Al activarla se completa el reemplazo de la V1 → acá va el go-live formal: rotar
  `MC_KEY` (la `MC_KEY_V2` de `.dev.vars`) + apagar lo que quede de V1 + borrar los 13
  custom fields muertos.**
- ⚠️ **ANTES de entregar el embudo (pedido explícito de Gabriel 2026-07-31): pasada
  completa de COPYS de todas las puertas** — las 5 automatizaciones de comentarios/quiz,
  la puerta de DM y los mensajes de las salidas. Revisar y mejorar cada texto (tono,
  persuasión, chileno natural) manteniendo los candados de honestidad. Los copys actuales
  son funcionales, no finales — B3 ya se renovó como referencia del estándar.

## 4 · El gran doc

Consolidación final (el 80% existe: runbook + guía as-built + diagramas + CHANGELOG):
un índice maestro que cuente el sistema de punta a punta, actualizado con lo que salga de
1–3. Se escribe al final, cuando nada se mueva.

## 5 · Del Airtable al tablero con niveles de acceso — EL CIERRE DE LA ETAPA

La URL única que pidió Roberto (reunión 2026-07-27): **un solo lugar con login por roles**
— Roberto/Alfonso ven el reporte; Luis ve y OPERA su Kanban (escritura en vivo a Airtable).
Es el ítem más grande: el tablero actual es estático (build time) con clave compartida;
esto requiere autenticación por rol, vistas en vivo y escritura. Se diseña cuando 1–4 estén
cerrados, con el aprendizaje real de cómo operó Luis las semanas previas.

---

## Definición de CERRADO

1. Leads entrando por comentarios ✅ (2026-07-30)
2. Luis operando el ciclo completo — las 5 salidas del Kanban despachando sus mensajes
3. DM capturando lo que hoy cae en bandeja
4. Todo documentado en el gran doc
5. V1 apagada, `MC_KEY` rotada
6. El tablero con roles EN VIVO y la operación de Luis viviendo ahí
