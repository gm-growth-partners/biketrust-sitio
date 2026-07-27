# V2 · Día 1 — Insumos de montaje (Cimientos)

> Preparado 2026-07-27. Complementa `MANYCHAT_REBUILD.md` §0.5–0.7 (pivote + plan + fe de
> erratas) y el cuaderno de montaje (`docs/cuaderno_montaje_biketrust.html`).
> **La MC_KEY nueva NO está en este documento**: vive en `.dev.vars` (gitignored) como
> `MC_KEY_V2`. Aquí siempre aparece como `<MC_KEY_V2>`.

---

## 0. Pre-checks (la mañana del D1, antes de tocar nada)

1. **Ventana de borrado**: `Leads` con `Fecha visita` no vacía → debe dar **0** (al 2026-07-27: ✅ 0, verificado por API). Si hay alguna visita futura, el retiro SE POSTERGA (checklist §1.3 del rebuild).
2. **Respaldo visual de la capa V1**: captura de pantalla de cada flow vivo antes de borrar (barato, irreversible después).
3. **Confirmar el add-on de IA de intención en el plan de ManyChat** (AI Intents / AI Steps). Es prerrequisito del D2 — si el plan no lo trae, se re-decide el diseño ANTES de demoler, no se degrada en silencio.
4. Tener a mano los subscriber ids del staff (sobreviven, son contactos): Luis `579628082` · Roberto `302195575`.

## 1. Orden del día (la secuencia importa)

```
1. Pre-checks (§0)
2. RETIRAR la capa V1: flows y custom fields viejos.
   ⛔ NUNCA tocar: los 9 flows-envoltorio de plantillas WhatsApp (sus namespaces
      viven en FLOW_NS_* de Cloudflare; re-aprobar plantillas cuesta días).
3. ROTAR MC_KEY en Cloudflare Pages (valor = MC_KEY_V2 de .dev.vars).
   → Se hace DESPUÉS de retirar (la V1 ya no llama, nada se rompe) y ANTES de
     montar (todo lo nuevo nace con la llave buena).
   → Los crons (worker-cron / cron-recordatorios) NO usan MC_KEY: siguen corriendo.
4. CREAR los 44 custom fields (§2) — los 5 literales del backend PRIMERO,
   verificando el nombre carácter por carácter.
5. MONTAR las 9 entradas (§3) como cascarones: trigger + tracking + salto a un
   spoke placeholder ("estamos armando esto, te escribo en un momento").
6. Verificación de cierre del D1 (§5).
```

## 2. Hoja definitiva de custom fields — son 44 (no 33 ni 34)

Conteo real extraído de las hojas del cuaderno (`grep cf_`). Todos **tipo texto**.

| Grupo | Campos | Nota |
|---|---|---|
| **A · Backend, nombre LITERAL** (5) | `cf_bici` `cf_fecha_visita` `cf_consigna_datos` `cf_solicitud_datos` `cf_llamado_datos` | Los escribe el backend por string (`setCustomFieldByName`). Un typo = mensajes que no salen y fallan en silencio. Crear primero y verificar. |
| **B · Identidad** (3) | `cf_lead_id` `cf_estado_aplicado` `cf_telefono` | |
| **C · Bici recomendada** (13) | `cf_hero_bici` `cf_hero_modelo` `cf_hero_precio` `cf_hero_talla` `cf_hero_ficha` `cf_hero_foto` `cf_alt_bici` `cf_alt_modelo` `cf_alt_precio` `cf_alt_ficha` `cf_otras_texto` `cf_match` `cf_modelo_buscado` | ⚠ Se BORRA completo (acción «borrar valor») al inicio de cada corrida, antes de llamar `mc-match` — si no, se arrastra la bici del lead anterior. |
| **D · Quiz** (4) | `cf_q_motor` `cf_q_disciplina` `cf_q_presupuesto` `cf_q_altura` | |
| **E · Modelo texto libre** (1) | `cf_modelo_texto` | |
| **F · Región** (2) | `cf_ciudad` `cf_franja` | |
| **G · Consignación** (6) | `cf_v_modelo` `cf_v_anio` `cf_v_talla` `cf_v_estado` `cf_v_precio` `cf_v_fotos` | |
| **H · Tickets devueltos** (3) | `cf_solicitud_id` `cf_llamado_id` `cf_consigna_id` | |
| **I · Conversación/agenda** (7, venían del cuaderno y faltaban en la hoja del rebuild) | `cf_no_texto_intentos` `cf_fecha_libre` `cf_valido` `cf_slot` `cf_mensaje` `cf_fecha_visita_legible` `cf_brief` | `cf_no_texto_intentos` = regla de dos golpes para fotos/stickers/audio. `cf_slot`/`cf_fecha_libre`/`cf_valido` = tronco de agenda. `cf_brief` = válvula mínima de escalamiento. |

## 3. Las 9 entradas (cascarones del D1)

Reglas comunes a TODA entrada de comentario (gotchas verificados de la V1):
- **`mc-lead` SIEMPRE antes** de `mc-evento`/`mc-match` (si corre después, el lead nace `Canal=Quiz` y se pierde la atribución al reel).
- El handle se inserta con el **campo de sistema «Nombre de usuario»** de IG (resuelve al @). NUNCA el merge tag literal — así nació el lead basura `@{{ig_username}}`.
- **Delay ~3 s** + respuesta pública breve **rotada** (3 variaciones) antes del DM (higiene anti-spam + prueba social en el post).
- La respuesta privada es **terminal**: el hilo continúa SOLO con botón de flujo («Ir a un paso»), nunca con solo URL.
- Máx 3 botones por mensaje (límite de Meta).

### 3.1 ENT-comentario ×6 (una por post, cada una con SU shortcode)

URLs: `https://biketrust-sitio.pages.dev/api/mc-lead?key=<MC_KEY_V2>` y `…/api/mc-evento?key=<MC_KEY_V2>` (POST, JSON).

Body 1 (mc-lead): `{ "handle": "<Nombre de usuario>", "canal": "Comentario IG" }`
Body 2 (mc-evento): `{ "handle": "<Nombre de usuario>", "estado": "ficha_entregada", "origen": "Puerta 1 (reel/comentario)", "resultado": "Ficha entregada", "reel": "<SHORTCODE>" }`

| # | Shortcode (`reel`) | Palabra del caption | Bici → ficha | Nota |
|---|---|---|---|---|
| 1 | `DbCLcpEB4aT` | «Epic 8» (dispara con cualquier palabra) | Epic 8 Pro · L → `/ficha/epic-8-pro-l` | El video estrella (13 interesados S30) |
| 2 | `DbEh9fBI9Np` | «SL» | Levo SL S-Works · M → `/ficha/levo-sl-s-works-m` | 9 interesados S30 |
| 3 | `DbQjdNLBmnv` | «Creo» | Creo SL S-Works · M → `/ficha/creo-sl-s-works-m` | 3 interesados S30 |
| 4 | `Dad9A_zJy0D` | «Levo SL» | Levo SL2 S-Works · S4 → `/ficha/levo-sl2-s-works-s4` | 3 comentaristas históricos quedaron sin capturar: cubrir any-word |
| 5 | `DZ1O3ViO2Qz` | *(caption sin palabra clave)* | Levo 4G S-Works · S4 → `/ficha/levo-4g-s-works-s4` | Trigger any-word («¿Se vendió?» de jb_sepulvedag se perdió por no tener ENT) |
| 6 | `DbJy7ynB5T4` | «Ruta» | **sin bici** — VS Tarmac/Creo | ⚠ DECISIÓN §4.1: la Tarmac del VS ya se vendió |

En `mc-evento`, el interés del post 6 va **sin resolución de bici** (la fila de `Reels` no
tiene `Bici` a propósito): el interés queda atribuido al video y la conversación deriva a
la ruta de asesoría.

### 3.2 Las otras 3 entradas

| Entrada | Trigger | Cascarón D1 |
|---|---|---|
| **ENT-DM** | Mensaje directo (default del canal) | `mc-lead` (`canal: "DM IG"`) → salto al clasificador de intención (spoke placeholder en D1) |
| **ENT-historia** | Respuesta a historia | Igual que ENT-DM (mismo clasificador) |
| **ENT-baja** | Keywords de baja (`baja`, `stop`, `no quiero`, `unsubscribe`) | Opt-out inmediato. Se evalúa ANTES que todo |
| **ENT-default** | Default reply (nada calzó) | Tag `modelo_no_reconocido` + guardar el texto en `cf_mensaje` + respuesta puente. El balde se revisa semanalmente (motor de mejora del clasificador) |

## 4. Decisiones abiertas (resolver antes o durante el D1)

1. **Reel «Ruta» (VS)**: el caption promete «las fichas de ambas» pero la Tarmac se vendió. Propuesta: honestidad de entrada («la Tarmac voló 🚀, la Creo sigue disponible») + ficha de la Creo + puente al quiz para el purista de ruta. Alternativa: editar el caption del post.
2. **Válvula de escalamiento** (`cf_brief`): mantenerla mínima — ¿en qué bordes exactos se dispara? (propuesta: negociación de precio explícita + trámites fuera de documento). Sin promesas de tiempo de respuesta.
3. **Palabra clave vs any-word** por post: any-word captura más (el «💎💎💎» de bikeprotekt entró así) pero puede responder a comentarios sociales. Propuesta: any-word en posts de bici específica; keyword estricta solo en el VS.

## 5. Verificación de cierre del D1

1. Los 5 campos literales existen con nombre exacto (compararlos contra `cron-recordatorios.js` / `mc-*.js`).
2. `MC_KEY` rotada: llamada con la llave vieja → **401**; con la nueva → responde.
3. Comentario de prueba (cuenta propia) en el post Levo SL2 → Lead + Interés con `Reel` ✓ en Airtable → borrar el registro de prueba por id.
4. DM de prueba → lead nace `DM IG` + cae en el cascarón del clasificador.
5. `cron-recordatorios?dry=1` → sin `errors` (los envoltorios WhatsApp sobrevivieron).
