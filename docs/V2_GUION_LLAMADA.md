# Guion de la llamada — una plana, para tener al lado del teléfono

> El bot ya hizo su trabajo: la persona **pidió** que la llamaran. No es una llamada en
> frío. Objetivo único: **terminar con una de las 4 salidas marcada y una fecha comprometida.**

---

## Antes de marcar · 30 segundos

Leer el brief en la pantalla: **bici · puntaje · precio · rango de altura · si sigue
disponible · qué escribió la persona**.

⚠️ Si `Estado bici` **no** dice «Disponible», no ofrecerla: partir por ahí con honestidad
(«esa se vendió, pero te consigo una igual») y la llamada pasa a ser de encargo.

## Apertura · los primeros 15 segundos

> «Hola {nombre}, soy Luis de Bike Trust. Me pediste que te llamara por la {modelo}.
> **Yo soy quien la inspeccionó.**»

- **Nombre + marca + motivo + credencial técnica.** Nunca «asesor comercial»: la credencial
  es haber revisado esa bici.
- Recordar que la persona pidió la llamada — no hay que pedir permiso ni disculpas.

## Entregar antes de preguntar · segundos 15 a 90

Dar primero lo que el bot prometió, sin pedir nada a cambio:

> «Te cuento lo que no se ve en la ficha: sacó {puntaje} de 7, y donde perdió puntos fue en
> {área}. Eso ya está considerado en el precio.»

## Las 5 preguntas, en este orden

| # | Pregunta | Para qué | Dónde se anota |
|---|---|---|---|
| 1 | **¿De qué comuna me hablas?** | Decide la salida. Nunca «¿eres de Santiago?»: invita a sí/no y no da la comuna. | `Ciudad` |
| 2 | **¿Cuánto mides?** | Se cruza con el rango de altura del brief y se le dice al tiro si le calza. | `Estatura (cm)` |
| 3 | **¿Para qué la vas a usar? ¿Hace cuánto andas?** | Una sola pregunta abierta. **Callarse 30–60 segundos.** De ahí salen solos el uso, el nivel y muchas veces el presupuesto. | `Notas` |
| 4 | **¿Tienes una bici ahora? ¿La venderías?** | Es la segunda línea del negocio y casi nadie la ofrece sin que le pregunten. | `Notas` |
| 5 | **¿Para cuándo la estás buscando?** | Separa al que compra esta semana del que está mirando. Define el próximo paso. | `Próximo paso` |

## La tabla de decisión

| Si… | Salida | Qué se compromete |
|---|---|---|
| Vive en Santiago **y** la bici le sirve | **Visita agendada** | Día y hora concretos → `Fecha y hora de visita` |
| Vive fuera de Santiago | **Coordinación región** | Video de la unidad + condiciones de despacho |
| No tenemos lo que busca (talla, modelo o presupuesto) | **Encargo de búsqueda** | Qué busca, hasta cuánto, y que le avisamos al entrar |
| No se pudo hablar con la persona | **No contestado** | Sale solo el mensaje de rescate; el ticket sigue abierto |
| Contestó pero no hay nada que hacer | **Sin interés** | Anotar el motivo real en `Notas` |

## El cierre · obligatorio, nunca opcional

> **«¿Te viene mejor el jueves a las 18:30 o el sábado a las 11:00?»**

Dos horarios concretos, y **callarse**. Nunca «¿te gustaría venir?» ni «¿cuándo te acomoda?».

*De 60 millones de llamadas analizadas: el 42 % de los leads convierte en la llamada, pero
solo el 46 % de los vendedores pide la cita. Más de la mitad se pierden por no pedirla.*

**Si no puede esta semana:**
> «Te la dejo apartada hasta el jueves, sin costo y sin compromiso. Si me dices que no, la libero.»

Nunca pedir seña ni transferencia por teléfono.

## El WhatsApp · no hay que pedirlo

El permiso ya está: el bot se lo dijo al pedir el número (*«si no te pilla, te deja un
WhatsApp a ese mismo número»*) y la persona lo entregó después de leerlo. **No hay casilla
que marcar.**

Vale mencionarlo al cerrar, pero como información, no como permiso:
> «Te dejo todo confirmado por WhatsApp a este mismo número.»

## Si se va en indirectas

Cuando dicen «lo voy a pensar», «te aviso», «lo converso en la casa»:

> «Perfecto, buena idea pensarlo. Solo para saber si te puedo ayudar: **¿qué te falta para decidir?**»

En Chile el no casi nunca se dice de frente. Sin esta pregunta, la cola se llena de fantasmas.
La respuesta va textual a `Notas`.

## Al colgar · dos pasos, en este orden

**Durante la llamada no se anota nada.** Escuchar y conversar; el sistema no pide nada
mientras la persona habla.

**1 · Clasificar (5 segundos).** Arrastrar la tarjeta a su columna. Eso ya avanza el estado
y, cuando corresponde, dispara el mensaje.

**2 · Completar, en la pantalla del caso:**
- **Visita** → la fecha y hora, y las 1 a 3 bicis a preparar. **La confirmación al cliente
  sale cuando pones la fecha**, no antes: sin fecha no hay nada que confirmar.
- **Encargo** → el ticket ya nació en Solicitudes; ahí van modelo, talla, presupuesto y uso.
- **Región** → la coordinación del despacho.

> **Un ticket sin próximo paso con fecha no está cerrado.**

## Si no contesta

| Intento | Cuándo |
|---|---|
| 1 | Apenas entra el ticket |
| 2 | +2 horas, en otra franja del día |
| 3 | Al día siguiente, 10:00–11:00 |
| 4 | Al tercer día, por la tarde |

Marcar **`No contestado`** después del primer intento fallido: el mensaje de rescate sale
solo y muchas veces la persona responde por ahí en vez de contestar el teléfono.
