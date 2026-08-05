# Bike Trust · El sistema V2 de punta a punta — el gran doc

> **Qué es esto.** El ítem 4 del [plan de cierre](V2_PLAN_CIERRE_ETAPA.md): el índice
> maestro que cuenta el sistema completo y apunta al documento canónico de cada pieza.
> No duplica contenido — si algo se contradice, **manda el as-built de cada pieza** y la
> historia vive en el [`CHANGELOG.md`](../CHANGELOG.md).
>
> Escrito 2026-08-05, con la etapa Embudo V2 verificada E2E (confirmación, 5 salidas,
> avisos al equipo) y a falta solo del go-live formal (rotación de llaves) y flecos de
> ManyChat.

---

## 1 · El negocio en una línea

Bike Trust vende Specialized usadas, premium y certificadas (Santiago). El diferenciador
es la **honestidad verificable**: nota de inspección 1–7 a la vista, «estado honesto» sin
maquillaje, y «si no la tenemos, te la conseguimos». El embudo digital existe para UNA
cosa: **conseguir el teléfono y que Luis llame** (meta del dueño: 20–30 % de los leads
entregan teléfono; la semana base S30 fue 3 %).

```
IG (comentario · DM · historia)
   → el bot entrega valor (ficha con nota /7 · estado honesto · ahorro)
   → pide el TELÉFONO → ticket en Llamados + WhatsApp a Luis
   → Luis llama y ARRASTRA la tarjeta a una de 5 salidas
   → sale solo el mensaje de esa salida (confirmación · región · encargo · rescate)
   → visita → cierre EN TIENDA (humano) → venta registrada → métricas
```

## 2 · Las tres puertas de entrada (ManyChat)

| Puerta | Cuándo dispara | Doc canónico (as-built) |
|---|---|---|
| **Comentarios** (4 reels + SL2 pendiente) | comentario con 1 de 10 keywords en un post con bici protagonista | [`V2_CONSTRUCCION_COMENTARIOS.md`](V2_CONSTRUCCION_COMENTARIOS.md) · diagrama [`embudo_comentarios_v2_bloques.svg`](embudo_comentarios_v2_bloques.svg) |
| **Quiz** (reels sin bici + catálogo viejo) | comentario any-word en los posts configurados | [`V2_CONSTRUCCION_QUIZ.md`](V2_CONSTRUCCION_QUIZ.md) · diagrama [`embudo_quiz_v2_bloques.svg`](embudo_quiz_v2_bloques.svg) |
| **DM** (bandeja + respuesta a historia) | cualquier DM de texto libre | [`V2_CONSTRUCCION_DM.md`](V2_CONSTRUCCION_DM.md) (las 8 etapas y 12 rutas) |

- El **enrutador de la puerta DM es nuestro**: [`/api/mc-clasifica`](../functions/api/mc-clasifica.js)
  (reglas deterministas, 45/45 tests; capa Workers AI dormida). El AI Step de ManyChat se
  descartó — lección §5.12 del [`CLAUDE.md`](../CLAUDE.md).
- **La convergencia es una sola**: B3 (oferta de llamada) → B4 (teléfono) → B5 (eco) →
  `mc-llamado` → B6 (confirmación con la promesa real calculada contra el horario de Luis).
- Los textos finales de todo el sistema: [`V2_PASADA_COPYS.md`](V2_PASADA_COPYS.md).
- La **regla de baja R1** es una automatización aparte (keywords exactos) que le gana al
  enrutador; el anti-bucle deriva a humano con `mc-aviso` + modo humano 24 h.

## 3 · La operación de Luis (Airtable)

**La cola central es la tabla `Llamados`** — todo lead que entrega teléfono cae ahí.
Interfaz «Operación Llamadas (V2)», 5 pantallas. Doc: [`V2_OPERACION_KANBAN.md`](V2_OPERACION_KANBAN.md)
· guía por rol: [`V2_GUIA_ROLES.md`](V2_GUIA_ROLES.md) · guion: [`V2_GUION_LLAMADA.md`](V2_GUION_LLAMADA.md).

1. **Llamadas** (Kanban por `Salida`): Luis llama con el brief automático (nota, rango de
   altura, precio, estado) y al colgar arrastra la tarjeta. Ese gesto dispara TODO.
2. **Visitas**: la tarjeta llega a **Pendiente** → Luis elige hasta 3 «Bicis para la
   visita» y pone «Fecha y hora de visita» → salta sola a **Agendada** y sale la
   confirmación → cuando el cliente toca «Sí, confirmo» pasa sola a **Confirmada**.
3. **Región**: pipeline de despacho (`Estado despacho`).
4. **Búsquedas**: los encargos (tabla `Solicitudes`) — al pasar a `Buscando`,
   `cron-sourcing` avisa a los dueños; al llegar la bici, `reactivacion_stock` al cliente.
5. **Agenda de visitas**: calendario.

**Las 5 salidas y su mensaje** ([`V2_SALIDAS_LLAMADA.md`](V2_SALIDAS_LLAMADA.md) —
las 5 verificadas con mensajes reales el 2026-08-05):

| Salida | Mensaje al cliente | Además |
|---|---|---|
| Visita agendada | `confirmacion_visita` (al completar la fecha) | copia fecha y bicis al Lead; recordatorios 48 h/8 am |
| Coordinación región | `region_gestionando` | pipeline de despacho |
| Encargo de búsqueda | `encargo_recibido` | nace el ticket en `Solicitudes` + aviso al staff |
| No contestado | `llamada_no_contestada` | el ticket VUELVE a la cola (suma intento) |
| Sin interés | — (nada, a propósito) | cierra el ticket |

## 4 · El backend (Cloudflare Pages Functions)

Catálogo completo y contratos: [`CLAUDE.md`](../CLAUDE.md) §3. Los esenciales del V2:

| Endpoint | Rol |
|---|---|
| `mc-lead` / `mc-evento` | upsert del Lead · avance de Estado + Interés (ficha rica con `soloEstado`) |
| `mc-match` | el matching (modo A modelo · modo B quiz con umbral honesto) |
| `mc-llamado` | crea el ticket + sella `Fecha teléfono` (métrica #1) + aviso `nuevo_llamado` |
| `mc-consigna` / `mc-waitlist` | vender / encargo «Consíganmela» |
| `mc-clasifica` | el enrutador del DM |
| `mc-aviso` | aviso «humano requerido» → plantilla `aviso_equipo` + registro en tabla `Avisos` |
| `salida-llamado` | el motor post-llamada: propaga permiso/fecha/bicis al Lead y despacha el mensaje de la salida (idempotencia SOLO del mensaje — los datos se refrescan siempre) |
| `cron-recordatorios` / `cron-reenganche` / `cron-sourcing` / `cron-briefing` | recordatorios 48 h/8 am · rescates (2 h/no-show/suelto AÚN APAGADOS) · sourcing · briefing 9 AM |
| `reservar` / `registrar-venta` / `recalcular-embudo` | web → reserva · venta atómica · tabla `Metricas` |

**El documento operativo del montaje ManyChat** (37 erratas corregidas, secuencias, envs):
[`V2_RUNBOOK_MANYCHAT.md`](V2_RUNBOOK_MANYCHAT.md) — manda sobre los docs de diseño.

## 5 · Las automatizaciones de Airtable (14 al 2026-08-05)

Las que gobiernan el V2 (el resto en CLAUDE.md §4):

- **«kanban a mensajes»** — observa `Salida` + `Fecha y hora de visita` + `Bicis para la
  visita` → llama a `salida-llamado`. (Con script: solo editable en UI.)
- **«Kanban: Salida vacía → Llamada pendiente»** · **«Llamados: Estado vacío → …»** — el
  ticket del bot nace en la primera columna.
- **«Kanban: Visita agendada → Estado visita = Pendiente»** → pantalla 2, columna Pendiente.
- **«Visitas: fecha puesta → Agendada»** — al completar la fecha, la tarjeta salta sola.
- **«Lead confirmó → Estado visita = Confirmada»** — el «Sí, confirmo» del cliente mueve
  la tarjeta (vía `mc-evento` `soloEstado` → Lead `visita_confirmada`).
- **«Kanban: Coordinación región → Estado despacho = Por coordinar»**.
- Sellos de instrumentación (1ª llamada en Llamados/Solicitudes · `Cuestionario iniciado`)
  y «Venta: Interés Cerró» (la cascada de venta).

## 6 · Métricas y reporte

- **Métrica #1: teléfonos** — `Leads.Fecha teléfono` (+ bandera `Llegó a teléfono`).
  La sella `mc-llamado` una sola vez. Comparativos por semana de COHORTE de entrada
  (reglas canónicas de conteo: informe S31 v3).
- **Avisos → conversión**: tabla `Avisos` (cada «humano requerido») con rollup
  «Terminó en venta».
- **Velocidad de Luis**: `Espera (min)` (ticket → 1ª llamada).
- **Tablero A3** (repo `biketrust-tablero`): 19 métricas + visitas, build-time, clave
  compartida. El **tablero con roles** (URL única de Roberto: reporte + operación de Luis)
  es el ítem 5 del plan de cierre — SE HACE AL FINAL, decisión 2026-08-05.
- Informes semanales: `Estrategia/V2/informe_semanal_*.html/pdf` (S30 y S31 entregados).

## 7 · Lo que está apagado o pendiente, y por qué (estado 2026-08-05)

| Cosa | Estado | Nota |
|---|---|---|
| Rescates: recordatorio 2 h · no-show · reenganche >3 días | 🔴 APAGADOS | envs `FLOW_NS_2H/NOSHOW/SUELTO` sin flujo; código listo — se encienden creando el flujo + env + redeploy |
| Duplicado Levo SL2 (6 elementos) | ⬜ | tabla de duplicación al final de `V2_CONSTRUCCION_COMENTARIOS.md` |
| B3 nuevo en comentarios/quiz + C-2 corto | ⬜ | `V2_PASADA_COPYS.md` §1–2 |
| Go-live formal: apagar restos V1 → **rotar `MC_KEY` + PAT** → borrar 13 cf muertos | ⬜ | runbook §9 · **la rotación SOLO con aprobación de Gabriel** |
| Costura **Ailoo** (alta de bici + venta con teléfono) | ⏸ | `Referencia` ya es la llave pública unidad a unidad; memoria `project_biketrust_ailoo_integracion` |
| Dominio `biketrust.cl` + `SITE_URL` · binding `AI` (capa IA del clasificador) · flujo propio `FLOW_NS_BUSCANDO` | ⬜ | deuda menor, CLAUDE.md §8 |
| Mejora «Vino»: compró/no + bici + precio efectivo en la misma card | 💡 futura | hoy vive en `registrar-venta` (Agenda) |

## 8 · Dónde está cada cosa (mapa de documentos)

| Tema | Documento |
|---|---|
| Historia y decisiones (leer primero en frío) | [`CHANGELOG.md`](../CHANGELOG.md) |
| Estado vivo + gotchas + lecciones | [`CLAUDE.md`](../CLAUDE.md) |
| Plan de cierre de la etapa (checklist) | [`V2_PLAN_CIERRE_ETAPA.md`](V2_PLAN_CIERRE_ETAPA.md) |
| Runbook del montaje (manda sobre diseño) | [`V2_RUNBOOK_MANYCHAT.md`](V2_RUNBOOK_MANYCHAT.md) |
| As-built comentarios / quiz / DM | `V2_CONSTRUCCION_{COMENTARIOS,QUIZ,DM}.md` |
| Copys finales | [`V2_PASADA_COPYS.md`](V2_PASADA_COPYS.md) |
| Salidas de la llamada + plantillas staff | [`V2_SALIDAS_LLAMADA.md`](V2_SALIDAS_LLAMADA.md) |
| Operación de Luis / roles / guion | `V2_OPERACION_KANBAN.md` · `V2_GUIA_ROLES.md` · `V2_GUION_LLAMADA.md` |
| Diagramas (técnico + dueños) | `embudo_*_v2_*.svg` · árboles `arbol_v2_*.svg` |
| Diseño histórico del pivote | `MANYCHAT_REBUILD.md` §0.5–0.7 · `V2_PLANTILLA_{COMENTARIOS,DM}.md` |
| Presentación a los dueños | `Estrategia/V2/guia_sistema_biketrust.html` (corregida 2026-08-05) |
| V1 (histórico; contratos §3/§5/§6 siguen vigentes) | [`EMBUDO.md`](../EMBUDO.md) |
