# Finanzas GM Growth Partners

`Finanzas_GMGP_2026.xlsx` — planilla de gestión financiera de **GM Growth Partners**
(la empresa, no el cliente Bike Trust). Entradas, salidas, impuestos mes a mes,
retiros hacia la cuenta personal y flujo de caja, en un solo archivo.

> ⚠️ Vive en este repo por comodidad, pero **no es parte del sitio**: `build.mjs`
> no la lee y no se publica en Cloudflare Pages. Si algún día molesta acá, se mueve
> sin romper nada.

## Cómo abrirla

- **Google Sheets** (lo más probable): Drive → *Nuevo* → *Subir archivo* → clic derecho
  sobre el archivo → *Abrir con* → *Hojas de cálculo de Google*. Todas las fórmulas
  usadas (`SUMIFS`, `INDEX`/`MATCH`, `IFERROR`, `YEAR`, `MONTH`, `ROUND`) existen en
  Sheets, y los menús desplegables y los dos gráficos se conservan.
- **Excel / LibreOffice**: se abre directo.

## Las 9 hojas

| Hoja | Qué es |
|---|---|
| `Instrucciones` | Cómo se usa, la rutina mensual y la anual. Partir por acá. |
| `Resumen` | Seis números del año, tabla mes a mes y dos gráficos. |
| `Ingresos` | ✍️ Una fila por documento emitido. |
| `Gastos` | ✍️ Una fila por documento recibido. |
| `Retiros` | ✍️ Giros a la cuenta personal + estimación del Global Complementario. |
| `Mensual` | El F29 mes a mes: IVA, PPM y retenciones. |
| `Renta` | Impuesto anual de la empresa y utilidad disponible. |
| `Flujo` | Caja mes a mes. |
| `Parámetros` | Tasas, UTM, listas y saldos iniciales. |

Sólo se escribe en las tres marcadas con ✍️. El resto se calcula solo.

## Supuestos tributarios

Régimen **Pro Pyme General (art. 14 letra D N°3)**, que tributa en **base caja**:
ingresos percibidos menos gastos pagados. Por eso cada movimiento lleva dos fechas
—emisión y pago— y la planilla las usa para cosas distintas.

Tasas cargadas para el año comercial **2026**, verificadas en agosto de 2026:

| Concepto | Tasa | Nota |
|---|---|---|
| IVA | 19 % | Tasa general. |
| Impuesto de Primera Categoría | 12,5 % | Rebaja transitoria 2025–2027 (Ley 21.755); sube a 15 % en 2028. |
| PPM mensual | 0,125 % | 0,25 % rebajado a la mitad por la misma ley. |
| Retención de honorarios a terceros | 15,25 % | Desde el 1-ene-2026 (era 14,5 %). |

Son **transitorias**: se revisan cada enero en `Parámetros §2`. Cambiar la celda
recalcula el año completo.

## Lo que la planilla NO hace

Corrección monetaria, depreciación de activo fijo y arrastre de pérdidas de años
anteriores. Para una empresa de servicios sin activos pesados la diferencia es menor,
pero **la declaración oficial la firma el contador**. Esto es una herramienta de
gestión, no un reemplazo.
