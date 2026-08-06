# V2 · Pasada de copys — versión final (2026-08-05)

> El repaso completo pedido por Gabriel (2026-07-31): revisar cada texto de cada puerta
> antes de entregar el embudo. **Veredicto por bloque: SE QUEDA o CAMBIAR → texto final.**
>
> **El estándar es el B3 nuevo de la puerta DM** (2026-07-30): Luis es una persona real
> que inspeccionó cada bici — no «un especialista» genérico; beneficios concretos, no
> promesas vagas; chileno natural sin caricatura; honestidad como diferenciador.
>
> **Los 4 candados (runbook §5.5) son intocables en cualquier redacción futura:**
> 1. Prohibido afirmar calce → única formulación: «la que más se acerca a lo tuyo».
> 2. No prometer talla → «la talla exacta se confirma contigo».
> 3. No decir «se ajusta a tu presupuesto».
> 4. La salida honesta dice «ninguna calza bien», nunca una venta que no ocurrió.
>
> Las **plantillas de WhatsApp aprobadas por Meta quedan FUERA** de esta pasada: editar
> su texto las manda de vuelta a revisión y deja el sistema sin mensaje mientras tanto.

---

## Resumen ejecutivo — qué hay que pegar de verdad

La mayoría de los textos ya está al estándar (las revisiones del 29–30 jul y 03 ago los
renovaron). **Los cambios reales son DOS pegas + una verificación:**

| # | Cambio | Dónde | Estado |
|---|---|---|---|
| 1 | **B3 nuevo** (reemplaza al «¿Te gustaría hablar…?») | Las 4 automatizaciones de comentarios + el quiz (5 lugares) | ✅ pegado y publicado 2026-08-05 |
| 2 | **C-2 de CONTACTO se acorta** (hoy pide confirmar el número y B4 lo vuelve a pedir) | Puerta DM, ruta CONTACTO | ✅ pegado 2026-08-05 |
| 3 | Verificar que **C2 (guard viejo) no siga montado** en ninguna automatización | Comentarios + quiz | ✅ verificado 2026-08-05 |

Todo lo demás: SE QUEDA (detalle abajo).

> **Pendiente que dejó esta pasada:** las automatizaciones por-reel más antiguas heredaron
> las **respuestas públicas de fábrica de ManyChat** («¡Inofrmación enviada! Revisa tus DMs 🌱»
> — con falta de ortografía, visible en el comentario público), no las 5 rotadas del estándar.
> Corregidas en la de la Levo SL2 el 2026-08-06; **falta revisarlas en epic 8 pro, Turbo Creo
> y Levo SL 21/07**.

---

## 1 · Cambio #1 · B3 — la oferta de llamada (comentarios y quiz)

**Texto viejo (aún montado en comentarios/quiz):**
```
¿Te gustaría hablar directamente con un especialista por teléfono para orientarte mejor?

Te resuelve las dudas que por chat no se responden bien: si esa talla te calza, el historial completo de la unidad, y cómo la despachamos si estás fuera de Santiago.
```

**Texto FINAL (el mismo de la puerta DM — idéntico en las 3 puertas a propósito:
se cambia en un solo estándar):**
```
Oye, mejor que te llame Luis 📞 Él inspeccionó personalmente cada bici que tenemos — nadie te va a responder más derecho.

En 5 minutos te dice cuál te calza según tu estatura, qué hay dentro de tu presupuesto, y si quieres te la aparta mientras decides.
```
Botones (sin cambio): `Sí, que me llamen` → B4 · `Por ahora no` → B7.

**Dónde pegarlo (5 lugares):** automatización SL (master) · Epic 8 Pro · Creo · Levo 4G ·
«Plantilla reel sin bici específica» (quiz). *(El duplicado Levo SL2 nace ya con el nuevo.)*

## 2 · Cambio #2 · C-2 de CONTACTO (puerta DM)

**Viejo:** `Dale, te llamamos 🙌 Confírmame el número tal cual, para no equivocarnos.`
**FINAL:** `Dale, te llamamos 🙌`
*(B4 pide el número inmediatamente después — pedirlo dos veces seguidas es redundante;
la validación real la hace B4 y el eco B5.)*

## 3 · Verificación · C2 eliminado

Decisión 2026-07-30: C2 (`cf_oferta_enviada` como guard post-delay) se quitó de TODAS las
automatizaciones de comentarios y del quiz — el cableado vigente es `D1 → A1 → B3` directo.
El as-built lo da por hecho; **verificar en pantalla que no quede ningún C2 conectado**.
*(A1 se conserva: su marca alimenta la guarda C-OFERTA de la puerta DM, que acorta a B4.)*

---

## 4 · Veredicto bloque por bloque (lo que SE QUEDA)

### Puerta de comentarios (as-built 2026-07-30)
| Bloque | Texto | Veredicto |
|---|---|---|
| Respuesta pública | 5 variantes rotadas «Te escribí al DM 📩…» | **SE QUEDA** · recordar que UNA variante lleve «Si no te aparece, míralo en Solicitudes de mensaje» |
| B1 | «Hola 👋 Vi tu comentario en la {{cf_bici_modelo}}…» | **SE QUEDA** — corto, nombra la bici, ofrece valor concreto (specs + nota de inspección) |
| B1-Q / B1-W | router de consulta + dirección/horario/catálogo | **SE QUEDA** (B1-W se re-apunta al enrutador DM en la 2ª iteración, ya anotado) |
| B2 (ficha) | modelo · talla · nota /7 · dónde perdió puntos · estado honesto · precio/ahorro | **SE QUEDA** — es el corazón de la propuesta de valor, no tocarlo |
| Nota e-bike | «Diagnóstico de batería… bajo 80% no la vendemos» | **SE QUEDA** — candado de honestidad con regla verificable |
| B2-V (vendida) | «Te soy derecho: esa unidad ya se vendió…» | **SE QUEDA** — confiesa de inmediato + convierte en encargo |
| B2-C (catálogo) | «Acá puedes ver todo… con su nota de 1 a 7 a la vista» | **SE QUEDA** |
| B4 (teléfono) | «Perfecto 🙌 ¿A qué número te llamamos?…» + reintento «se cortó un dígito 🙈» | **SE QUEDA** |
| B5 (eco) | «Anotado: {{cf_telefono}} ✅» Correcto/Corregir | **SE QUEDA** — único dato tecleado, el eco caza el dígito malo |
| B6 / B6-D | «Listo ✅ Te va a llamar Luis Sulbarán… Te marca desde el +56 9 2181 5855… Si no te pilla, te deja un WhatsApp» | **SE QUEDA** — la última línea es el permiso del ciclo No contestado (jamás sacarla) |
| B7 (salida blanda) | «Dale, sin problema 👌 Cero llamadas…» | **SE QUEDA** |

### Quiz (reels sin bici + ruta ASESORIA)
| Bloque | Veredicto |
|---|---|
| B1-G «En este video no hay una sola bici protagonista — mejor te ayudo a encontrar la tuya» | **SE QUEDA** |
| QZ 1/3 · 2/3 · 3/3 (uso · presupuesto · estatura, con ejemplos de formato) | **SE QUEDA** |
| B2-Q ficha del hero («la que más se acerca a lo tuyo… la talla exacta se confirma contigo») | **SE QUEDA** — es el candado 1+2 |
| NM salida honesta («ninguna calza bien con lo que me dijiste 🙈 … te la conseguimos») | **SE QUEDA** — candado 4 |
| B2-ALT «También te podría servir…» | **SE QUEDA** |

### Puerta DM (as-built 2026-08-03/04 — ya nació al estándar)
| Bloque | Veredicto |
|---|---|
| SALUDO (abierto, sin menú) · BICI_SUELTA (2 botones) · NM-A | **SE QUEDAN** |
| VENDER V-1..V-4 («Mientras más derecho seas, más firme es el número…») + V-7 puente | **SE QUEDAN** — V-7 vende la inspección y la regla del 4 |
| VISITA · ENVIOS · GARANTIA (6 meses + recompra 12) · PAGOS (fallback) | **SE QUEDAN** · GARANTIA: no agregar detalle hasta que el doc pase revisión legal |
| TECNICA («Buena pregunta 🙌 Esa es de las que responde Luis…») + T-2 | **SE QUEDAN** |
| CIERRE («Dale, sin apuro 👌…») · AB-3 («Espérame un poco 🙌…» sin prometer plazo) · E-2 excusa adjuntos | **SE QUEDAN** |
| R1 baja («Listo, no te escribimos más 👌», mensaje ANTES del unsubscribe) | **SE QUEDA** |
| B3 de la DM | **SE QUEDA** — es el estándar de referencia |

### Salidas de la llamada (plantillas Meta — NO tocar el texto)
`confirmacion_visita` · `recordatorio_48h` · `recordatorio_2h` · `region_gestionando` ·
`llamada_no_contestada` · `encargo_recibido` · `aviso_equipo` · `nuevo_llamado` ·
`nueva_solicitud` · `reactivacion_stock` — **aprobadas; editar = re-revisión de Meta.**
Los reemplazos ya diseñados (`nuevo_llamado_v2`, `briefing_diario_v2`, en
`V2_SALIDAS_LLAMADA.md` §1-bis) se crean como plantillas NUEVAS cuando se decida, sin
tocar las vigentes.

---

## 5 · Mejoras de 2ª iteración (anotadas, NO van en esta pasada)

1. **`cf_ficha_intro` por puerta** — que la intro de la ficha rica distinga MODELO exacto
   («La tengo 🙌 acá va») de quiz («la que más se acerca»). La versión fina necesita la
   bandera `heroExacto` en `mc-match` (cambio de código + deploy). Hoy la intro única
   «la que más se acerca a lo tuyo» es correcta en ambos casos (nunca miente) — por eso
   puede esperar.
2. **Nutrición post-catálogo** (B2-C / B1-W): preguntar al rato si le interesó algún
   modelo. Necesita ventana abierta o plantilla — es un mini-ciclo de reenganche, no un
   bloque más.
3. **Variante del reel «Ruta» con bici propia** cuando vuelva a haber una bici de ruta
   protagonista (hoy deriva al quiz, correcto).
