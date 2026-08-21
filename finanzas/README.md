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

## Las 10 hojas

| Hoja | Qué es |
|---|---|
| `Instrucciones` | Cómo se usa, la rutina mensual y la anual. Partir por acá. |
| `Resumen` | Seis números del año, tabla mes a mes y dos gráficos. |
| `Ingresos` | ✍️ Una fila por documento emitido. El cobro se llena solo desde `Pagos`. |
| `Pagos` | ✍️ Una fila por cobro recibido. Cliente en cuotas = una fila por cuota. |
| `Gastos` | ✍️ Una fila por documento recibido. |
| `Retiros` | ✍️ Giros a la cuenta personal + estimación del Global Complementario. |
| `Mensual` | El F29 mes a mes: IVA, PPM y retenciones. |
| `Renta` | Impuesto anual de la empresa y utilidad disponible. |
| `Flujo` | Caja mes a mes. |
| `Parámetros` | Tasas, UTM, listas y saldos iniciales. |

Sólo se escribe en las cuatro marcadas con ✍️. El resto se calcula solo.

## Datos cargados

Al **20 de agosto de 2026**, con todos los movimientos de la cuenta Mercado Pago
de la empresa y las 3 facturas electrónicas emitidas.

| Hoja | Qué trae |
|---|---|
| `Ingresos` | Facturas N°1 (Turismo Palmenia, $238.000), N°2 (Centro Educativo Ingenia, $141.000) y N°3 (BA Certificadas, $750.000). |
| `Pagos` | 5 cobros. La N°2 entró en **3 cuotas de $47.000** por suscripción de Mercado Pago (jun/jul/ago). |
| `Gastos` | ManyChat ×3, Airtable y una compra de equipamiento en Mercado Libre. |
| `Retiros` | 4 giros a la cuenta personal por $160.214 en total. |

**Los pagos al SII no se registran en `Gastos`** — son el impuesto mismo, no un gasto,
y la planilla ya lo calcula en `Mensual`. Registrarlos ahí los contaría dos veces y
rebajaría indebidamente la base imponible.

### Conciliación

`Flujo` trae abajo un bloque para cuadrar la planilla contra el saldo real del banco.
Con los datos al 20-ago la diferencia es **$548**, que se explica así: +$3.000 de una
recarga de la cuenta que no es venta, −$2.800 de pagos al SII ya hechos, y +$348 del
PPM que la planilla estima para el mismo período.

⚠️ Ese cruce deja a la vista algo que conviene revisar: se pagaron **$2.800 al SII**
($470 en julio y $2.330 en agosto) cuando el PPM del período, según lo efectivamente
percibido, era de **$348**. Vale la pena verlo con el contador.

⚠️ La factura N°1 se **cobró el 4 de julio y se emitió el 11 de agosto**. Si es así,
el IVA de esa venta se declaró un mes tarde.

## Supuestos tributarios

Régimen **Pro Pyme General (art. 14 letra D N°3)**, que tributa en **base caja**:
ingresos percibidos menos gastos pagados. Por eso emisión y cobro viven separados
—la factura en `Ingresos`, el dinero en `Pagos`— y la planilla los usa para cosas
distintas: el **IVA** se declara con la emisión aunque el cliente aún no pague, y el
**PPM, la renta y el flujo** sólo se mueven cuando la plata entra.

### Cobros en cuotas

Una factura puede tener uno o muchos cobros, así que los pagos viven en su propia
hoja en vez de en columnas `Pago 1`, `Pago 2`… que siempre se acaban. Cada fila de
`Pagos` lleva fecha, N° de la factura, N° de cuota y monto; `Ingresos` calcula solo
el total cobrado, el saldo, cuántos pagos van y el estado (`Pendiente` → `Abonada` →
`Pagada`).

Como el monto que entra es bruto y los impuestos se calculan sobre el neto, cada
cuota **imputa la misma proporción de neto que tiene su factura**. La suma del año
calza con lo facturado salvo uno o dos pesos de redondeo.

El **N° de documento es la llave** entre ambas hojas: si no coincide exacto, el pago
queda huérfano y la columna `Cliente` de `Pagos` lo avisa con `⚠ n° no existe`.

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
