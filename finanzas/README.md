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

El libro trae las **3 facturas reales de agosto de 2026** (F-001 a F-003) con sus
cobros en la hoja `Pagos`. `Gastos` y `Retiros` están **vacías a propósito**: tenían
filas de ejemplo inventadas que, mezcladas con ingresos reales, producían un impuesto
y un flujo falsos.

⚠️ Dos cobros quedaron con **fecha anterior a la de emisión** (F-001 emitida 11-08 y
cobrada 04-07; F-002 emitida 12-08 y cobrada 10-02). Son los datos tal como están en
el archivo: si es correcto —trabajos cobrados antes y facturados en agosto— el IVA de
esas ventas se declaró tarde y conviene revisarlo con el contador.

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
