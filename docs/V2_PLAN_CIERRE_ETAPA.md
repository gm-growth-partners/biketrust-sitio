# Plan de cierre — Etapa Embudo V2

> Definido por Gabriel el 2026-07-30 (madrugada), con la puerta de comentarios recién
> en producción. **Estos 5 ítems, en este orden, cierran la etapa** — el 5 incluido
> (decisión de Gabriel: no se saca a etapa aparte).

**Punto de partida:** 4 automatizaciones V2 LIVE (Levo SL master · Epic 8 Pro · Creo ·
Levo 4G), E2E verificado contra Airtable, registros de prueba limpios. Falta el duplicado
de la Levo SL2 (queda dentro del ítem 2).

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

## 2 · Embudo para reels sin bici específica

- Duplicado **Levo SL2** pendiente (6 elementos — ver guía de construcción).
- **Variante B1-G** (diseñada): B1 genérico → asesoría/catálogo → convergencia. Sin
  C1a/C1b/fichas. Acción 0 mínima (solo `mc-lead`); `mc-llamado` sin `reel`.
- **Catch-all any-word** para el catálogo viejo, CON compuerta: **probar el doble disparo**
  (¿la automatización de "cualquier post" colisiona con las específicas?). Si colisiona →
  duplicados selectivos por post en vez de catch-all.
- Incluye el testimonio `DatyQVJuTFT` (fila en `Reels` lista, sin bici, keyword «Bici»).

## 3 · Puerta de DM con placeholders

- Diseño CERRADO en runbook §5 (AI Step enrutador, 2 campos listos para pegar).
- Placeholders asumidos: los 4 textos de Roberto (Grupo D lanza con fallback) y el quiz
  fuera (ASESORIA → B3, vuelve en 2ª iteración con umbral + `quiz_iniciado`).
- Las 4 verificaciones de pantalla del §5.10 (salida del AI Step · precedencia de la baja ·
  AI Step mudo · encolamiento).
- **Al activarla se completa el reemplazo de la V1 → acá va el go-live formal: rotar
  `MC_KEY` (la `MC_KEY_V2` de `.dev.vars`) + apagar lo que quede de V1 + borrar los 13
  custom fields muertos.**

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
