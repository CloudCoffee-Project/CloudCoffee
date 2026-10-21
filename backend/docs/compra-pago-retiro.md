# Contrato de compra, pago simulado y retiro · INT2-50

Versión 1.0.0. Contrato objetivo para las issues de implementación del Sprint 2.
La definición HTTP está en [compra-pago-retiro.openapi.json](compra-pago-retiro.openapi.json).
Este documento define las reglas de negocio que complementan sus schemas.
Cambios incompatibles requieren una nueva versión y coordinación con los clientes.

## Alcance y estado de implementación

`order-service` es dueño de compras, órdenes, pagos simulados y credenciales de
retiro. `catalog-service` es dueño de ofertas, precios y reservas de stock.
Auth determina identidad, rol y asignación del personal a cafeterías; Notification
consume eventos para correo y WebSocket. Cada servicio conserva su propia base.

Esta entrega define el contrato; **no publica endpoints nuevos**. En `main`,
Order solo tiene infraestructura y la migración inicial. Gateway todavía no
enruta compras/órdenes ni admite `Idempotency-Key` en CORS. Las implementaciones
corresponden a INT2-51/52/53/54/55/64/65/71–81/98. Swagger de Sprint 1 sigue
documentando únicamente Auth y Catálogo; el JSON adjunto puede importarse en un
visor OpenAPI sin iniciar servicios.

El único método de entrega es retiro en cafetería. El pago es una simulación
interna a Order: no pide tarjeta, no crea un `payment-service`, no devuelve
`initPoint`, no usa Mercado Pago, redirecciones ni webhooks externos. Seleccionar
un escenario de prueba no permite enviar importes ni escribir el estado del pago.

## Identidad, importes y snapshots

* Todas las rutas HTTP del contrato requieren JWT RS256. `CLIENTE` opera solo
  sobre compras/órdenes cuyo `clienteId` coincide con `sub`. El cuerpo de creación
  acepta exclusivamente `items: [{ofertaId, cantidad}]`; no acepta propietario,
  rol, precio, total, estado ni cafetería elegidos por el cliente.
* Una compra contiene una orden por cafetería distinta. Se admiten entre 1 y 100
  ofertas distintas, cantidades enteras entre 1 y 100. Ofertas repetidas son `400`.
  No se mezclan campus: todas las cafeterías deben pertenecer al mismo campus.
* Order consulta al Catálogo: oferta, producto y cafetería deben estar activos y
  la cafetería abierta para vender. Recursos desconocidos, inactivos o de otro
  campus producen `409 OFERTA_NO_DISPONIBLE` sin crear una compra parcial.
* Los importes son enteros en pesos chilenos (`moneda: CLP`), sin decimales,
  despacho ni recargos. El precio final incluye impuestos; no se calcula otro IVA
  sobre él. `subtotal = cantidad × precioUnitario`, `orden.montoTotal = Σ subtotal`
  y `compra.montoTotal = Σ montoTotal` de órdenes no canceladas. Máximo por compra:
  2.000.000.000 CLP; un exceso se rechaza con `400` antes de reservar.
* Cada ítem conserva `ofertaId`, `productoId`, `productoNombre`, `cantidad`,
  `precioUnitario` y `subtotal`. Orden conserva nombre/ID de cafetería y su total.
  Son snapshots tomados al reservar, no joins a precios actuales. Una orden que
  aún no logra reservar conserva una cotización provisional: se vuelve a validar
  al confirmar; si cambió el precio, `409 PRECIO_CAMBIO` devuelve la cotización
  vigente para revisión y exige otra confirmación con una nueva clave.
* Las órdenes canceladas conservan sus importes e ítems históricos, pero ya no
  suman al total cobrable. Tras iniciar el pago, su importe y conjunto de órdenes
  quedan congelados. No se admite cancelación parcial durante el pago. Cancelar
  la compra completa deja su total cobrable en cero; el pago conserva el importe
  original para auditoría, aunque termine rechazado.
* IDs son UUID, fechas son UTC RFC 3339. `version` es un entero monotónico por
  compra/orden para reconciliar lecturas y eventos; no es un contador global.
  `codigoOrden` es legible para atención, nunca una credencial de retiro.

## Disponibilidad, revisión y reservas

Crear una compra intenta reservar cada orden completa, con operación atómica por
oferta y compensación por orden: si falta cualquier ítem de una cafetería, libera
lo que alcanzó a reservar de esa orden y la deja en `revision_requerida`. Las otras
órdenes pueden quedar en `pendiente_pago`, con reservas válidas. Se responde `201`
con toda la compra; nunca se reduce cantidad ni se sustituye una oferta en silencio.

La compra queda en `revision_requerida` si alguna orden activa requiere revisión;
de lo contrario, en `pendiente_pago`. No se permite pagar mientras exista revisión.
El comprador puede reintentar reservar una orden con `confirmar`, cancelar esa
orden, confirmar todas las que requieren revisión o cancelar toda la compra.

Confirmar solo opera sobre órdenes en revisión. Revalida disponibilidad, precios
y reserva el conjunto solicitado completo. Si sigue faltando stock, devuelve
`409 STOCK_INSUFICIENTE` y compensa únicamente las reservas nuevas de ese intento;
conserva las anteriores vigentes. Si cambia una cotización, actualiza el snapshot
provisional y la versión, permanece en revisión y devuelve `409 PRECIO_CAMBIO`
con `compra` actualizada en el problema. El cliente debe mostrarla antes de enviar
otra confirmación. Órdenes ya reservadas no se recotizan. Cancelar la última orden
activa cancela la compra y deja `montoTotal: 0`.

El plazo común es **15 minutos desde la creación** (`reservaExpiraAt`), incluso
para órdenes reservadas después de una revisión. No se extiende al confirmar,
pagar, consultar o reintentar. A partir de ese instante (`now >= reservaExpiraAt`)
se impide aprobar, se cancelan las órdenes impagas y se liberan sus reservas.
Un pago pendiente pasa a rechazado con motivo `reserva_vencida`. Sin pago iniciado,
`pago` sigue siendo `null`. El vencimiento usa reloj del servidor.

El contrato interno de Catalog requerido por INT2-51/74/75 consiste en reservar
por `ordenId` y sus ítems hasta ese vencimiento, confirmar y liberar por `reservaId`.
Las tres operaciones son idempotentes: la misma orden/contenido devuelve la misma
reserva; otro contenido entra en conflicto. Una reserva pasa de `activa` a
`confirmada` o `liberada`, nunca ambas. Reservar descuenta disponibilidad;
confirmar no vuelve a descontar; liberar restaura solo una vez. No son rutas
públicas de Gateway ni se autoriza a un comprador a llamar operaciones internas.

La aprobación confirma **el lote de reservas de todas las órdenes activas** en
una sola transacción de Catalog, identificado por `compraId` y la lista de
`reservaId`. Si alguna no está activa o ya venció, no confirma ninguna. El proceso
de vencimiento y la confirmación bloquean las mismas reservas; el resultado del
lote se conserva para resolver respuestas perdidas. Así no queda una compra con
parte del stock vendido y el resto liberado. Cancelación/rechazo liberan solo
reservas activas, nunca reservas confirmadas.

Fallo de infraestructura tras reservar parcialmente: Order conserva el intento y
las compensaciones pendientes de forma durable, responde `503 OPERACION_PENDIENTE`
y `Retry-After: 2`, y no crea otra compra al reintentar con la misma clave.
Reanuda tras reinicio; no confunde este caso con falta de stock de negocio.

## Estados y transiciones

| Recurso | Estado | Significado / salida permitida |
| --- | --- | --- |
| Compra | `revision_requerida` | Alguna orden requiere reserva/revisión. Confirmar → `pendiente_pago` si todas se reservan; cancelar → `cancelado`. |
| Compra | `pendiente_pago` | Todas las órdenes activas están reservadas. Pago aprobado → `pagado`; rechazo, cancelación o vencimiento → `cancelado`. |
| Compra | `pagado` | Pago aprobado; estado financiero terminal, aunque las órdenes se retiren después. |
| Compra | `cancelado` | Terminal; no admite pago ni reactivación. |
| Orden | `revision_requerida` | Sin reserva completa. Confirmar → `pendiente_pago`; cancelar/vencer → `cancelado`. |
| Orden | `pendiente_pago` | Con reserva. Pago aprobado → `pagado`; rechazo/cancelación/vencimiento → `cancelado`. |
| Orden | `pagado` | Pago y stock confirmados. Cajero de su cafetería → `listo_para_retiro`. |
| Orden | `listo_para_retiro` | QR habilitado. Entrega válida → `entregado`; vence el retiro → `no_retirado_pendiente_revision`. |
| Orden | `entregado` | Terminal; retiro registrado una vez. |
| Orden | `no_retirado_pendiente_revision` | Venció el retiro; no admite QR. Resolución del personal → `no_retirado_final`. |
| Orden | `no_retirado_final` | Terminal. Reingreso/descarte por ítem se especificará en una issue posterior; no implica reembolso automático. |
| Orden | `cancelado` | Terminal. No admite QR, preparación ni entrega. |
| Pago | `pendiente` | Simulación pendiente o confirmación de stock en curso. → `aprobado` o `rechazado`. |
| Pago | `aprobado` / `rechazado` | Terminales; no se reemplaza ni reinicia el pago de esa compra. |

`reservando` es un paso interno de la operación durable; no es un estado editable
ni una respuesta de negocio estable. No existe un endpoint genérico para escribir
estados. Una transición no permitida devuelve `409 ESTADO_INVALIDO`.

Al vencer `retiroHasta`, tanto `pagado` como `listo_para_retiro` pasan a
`no_retirado_pendiente_revision`, incluso si el cajero nunca marcó la orden lista.

La cancelación completa está permitida en revisión o pendiente de pago, incluso
con simulación pendiente: serializa con aprobación/vencimiento, rechaza el pago
pendiente (`compra_cancelada`) y libera reservas. Si la aprobación ganó la carrera,
cancelar devuelve `409`. Las acciones parciales se permiten solamente antes de
crear el pago. No hay cancelación de una compra pagada ni reembolso en esta versión.

## API pública y permisos

Gateway elimina solo `/v1`; Order recibe `/compras/**` y `/orders/**`.
Todas las mutaciones requieren `Idempotency-Key`, salvo la validación de QR que
solo consulta. Las respuestas con datos de compra, pago y QR usan `Cache-Control: no-store`.

| Método y ruta pública | Permiso | Respuesta |
| --- | --- | --- |
| `POST /v1/compras` | CLIENTE | `201 Compra`; `Location: /v1/compras/{compraId}`. |
| `GET /v1/compras?page=0&size=20` | CLIENTE | `200 PaginaCompras`, solo propias, fecha e ID descendentes. |
| `GET /v1/compras/{compraId}` | Propietario CLIENTE | `200 Compra` con órdenes y pago actual o `null`. |
| `POST /v1/compras/{compraId}/confirmar` | Propietario CLIENTE | `200 Compra`, reintenta todas las órdenes en revisión. Sin cuerpo. |
| `POST /v1/compras/{compraId}/cancelar` | Propietario CLIENTE | `200 Compra`. Sin cuerpo. |
| `POST /v1/orders/{ordenId}/confirmar` | Propietario CLIENTE | `200 Orden`, reintenta esa orden. Sin cuerpo. |
| `POST /v1/orders/{ordenId}/cancelar` | Propietario CLIENTE | `200 Orden`. Sin cuerpo. |
| `POST /v1/compras/{compraId}/pago` | Propietario CLIENTE | `201 Pago` con `{escenario: aprobar\|rechazar\|pendiente}`. |
| `GET /v1/compras/{compraId}/pago` | Propietario CLIENTE | `200 Pago`; `404` si aún no se inició. |
| `GET /v1/orders?page=0&size=20&estado=listo_para_retiro` | CAJERO asignado | `200 PaginaOrdenes`, solo cafetería asignada; filtro de estado opcional. |
| `GET /v1/orders/{ordenId}` | Propietario CLIENTE o CAJERO asignado | `200 Orden`. |
| `POST /v1/orders/{ordenId}/listo` | CAJERO asignado | `200 Orden`, habilita retiro. Sin cuerpo. |
| `GET /v1/orders/{ordenId}/qr` | Propietario CLIENTE o CAJERO asignado | `200 QrRetiro` solo con pago aprobado y orden lista. |
| `POST /v1/orders/validar-retiro` | CAJERO asignado | `{codigo}` → `200 ValidacionRetiro` con orden y vencimiento; no entrega. |
| `POST /v1/orders/{ordenId}/entregar` | CAJERO asignado | `{codigo}` → `200 Orden` entregada. |

Páginas: `page >= 0`, `1 <= size <= 100`, predeterminado 20. Forma:
`{content, number, size, totalElements, totalPages, first, last, empty}`. Fuera del
rango devuelve contenido vacío; sin resultados `totalPages: 0`, `first/last: true`.
Compras y órdenes se ordenan por `creadoAt DESC, id DESC`.
No hay parámetro público `clienteId` ni `cafeteriaId` para ampliar acceso.

Order valida propiedad y asignación en servidor, además del rol JWT. No confía en
claims de cafetería ni campos de UI: la asignación persistida de INT2-65 se obtiene
por un mecanismo interno autenticado, sin leer tablas de otro servicio. Mientras
no pueda comprobarla, falla cerrado. Recurso ajeno devuelve `404` para no revelar
existencia; rol no permitido o cajero sin asignación devuelve `403`. `ADMIN_CAFETERIA`
y `SUPER_ADMIN` no heredan permisos de comprador/cajero por su nombre en esta API.

## Idempotencia y concurrencia

`Idempotency-Key` es un UUID generado para **una intención**, persistido por el
cliente hasta resolverla. Order registra de forma durable y única la tupla
`(sub, método, ruta canónica, clave)`, el hash del cuerpo normalizado y el resultado.
Ordenar ítems por `ofertaId` normaliza la creación; cantidades forman parte del hash.

* Misma tupla y contenido: reproduce código, cuerpo y `Location` de la primera
  respuesta terminada, con `Idempotency-Replayed: true`; no repite reservas, pagos,
  entrega ni eventos. El replay es un snapshot: consultar `GET` para estado actual.
* Misma tupla con otro contenido: `409 IDEMPOTENCY_CONFLICT`. Otra ruta o usuario
  tiene su propio espacio. Validar JWT y acceso antes de revelar un resultado.
* Intento todavía en curso/compensación: `409 IDEMPOTENCY_IN_PROGRESS`, o `503
  OPERACION_PENDIENTE` si falló una dependencia, con `Retry-After: 2` en ambos.
  No almacenar ese error transitorio como resultado definitivo.
* Se conserva el registro al menos 24 horas después de terminar. Fuera de ese
  periodo, consultar por el ID conocido; si se eliminó el registro, la misma clave
  de creación ya no garantiza deduplicación. El cliente no debe crear otra compra
  automáticamente ante un resultado desconocido.
* Un error de negocio definitivo (incluido `PRECIO_CAMBIO` con snapshot revisado)
  se conserva. Tras revisar/corregir, una nueva intención usa otra clave. Errores de
  autenticación/validación previos a la operación no consumen la clave.
* Para un mismo pago, claves distintas tampoco crean un segundo pago: `409
  PAGO_YA_INICIADO`. Para entrega ya hecha, otra clave devuelve `409 QR_UTILIZADO`;
  la misma clave de entrega reproduce el éxito previo.

Pago, cancelación, expiración y entrega requieren serialización por agregado o
control de versión equivalente. Si la comunicación con Catalog se interrumpe,
persistir la decisión y reanudarla: no liberar una reserva que ya ganó la decisión
de confirmación ni declarar aprobación hasta confirmar todas las reservas. Un
reintento no genera otra decisión ni otro `eventId` para la misma transición.
Si se perdió la respuesta de confirmación del lote, consultar/reintentar esa
misma operación antes de aceptar una cancelación o ejecutar compensaciones;
mientras no se conozca su resultado, responder `503 OPERACION_PENDIENTE`. Solo
un lote rechazado por vencimiento permite rechazar el pago y liberar reservas;
un lote ya confirmado exige finalizar la aprobación, aun tras un reinicio.

Gateway debe permitir `Idempotency-Key` en preflight y exponer `Location`,
`Idempotency-Replayed` y `Retry-After` a orígenes autorizados (INT2-98). Esta issue
no modifica CORS, enrutamiento ni autenticación actuales.

## Pago simulado

Una compra tiene como máximo un pago. El comando admite solo `escenario`; importe,
moneda, identidad y estados se derivan del servidor. Siempre responde
`simulado: true` y `proveedor: simulado`. Los clientes deben mostrar «Pago simulado».

| Escenario | Resultado |
| --- | --- |
| `aprobar` | Confirmar todas las reservas vigentes; solo entonces pago `aprobado`, compra y órdenes activas `pagado`, motivo `aprobacion_simulada`. Si Catalog demora, queda `pendiente`, motivo `procesando_stock`, y se reconcilia de forma durable. |
| `rechazar` | Pago `rechazado`, motivo `rechazo_simulado`; compra/órdenes activas canceladas; liberar reservas con reintentos durables. |
| `pendiente` | Pago `pendiente`, motivo `escenario_pendiente`; conserva reservas hasta el plazo común y luego se rechaza por `reserva_vencida`. No se resuelve enviando otro escenario. |

El comando crea el recurso con `201`, incluso si su estado es pendiente. `GET`
no causa cambios ni cobra: para la UI se recomienda polling cada 2 segundos
mientras está pendiente, con retroceso ante errores; WebSocket acelera la lectura,
pero HTTP es la fuente de reconciliación. Un fallo de red conserva la clave del
comando; no se abre una nueva simulación. Rechazo/vencimiento requieren una nueva
compra para volver a intentar pagar. El simulador se separará detrás de una
interfaz de proveedor dentro de Order (INT2-53/76), sin integrar proveedores reales.

## QR y entrega

Al aprobar el pago se fija `retiroHasta = aprobadoAt + 2 horas` por orden. Al pasar
a `listo_para_retiro`, Order habilita un token opaco aleatorio de al menos 256 bits
(Base64URL de 43 caracteres), sin datos personales ni estado codificados. El QR
contiene exactamente ese token, que también sirve para ingreso manual. El servidor
conserva un hash para validarlo y una representación protegida si necesita volver
a mostrar el mismo código. No registrar tokens ni incluirlos en eventos/correos.

Consultar de nuevo/recargar devuelve la misma credencial mientras esté vigente,
sin extender `expiraAt` (igual a `retiroHasta`). Validar o entregar comprueba token,
orden, pago aprobado, cafetería del cajero, estado listo y `now < expiraAt`.
Validar no bloquea el código ni garantiza una entrega posterior: entregar vuelve
a validar atómicamente y registra `entregadoAt` y `entregadoPor` en auditoría.

Token desconocido/malformado → `400 QR_INVALIDO`; otra cafetería u orden ajena →
`404`; token de una orden distinta de la URL → `400 QR_INVALIDO`; usado → `409
QR_UTILIZADO`; vencido → `409 QR_VENCIDO`; impago/no listo → `409 ESTADO_INVALIDO`.
Dos cajeros concurrentes solo consiguen una entrega. Reintentar con la misma clave
reproduce el éxito; el QR no autoriza por sí mismo a un cliente a marcar entrega.
Vencer retiro no libera automáticamente stock ya vendido.

## Errores

Se conserva Problem Details de `common-errors`, `application/problem+json`:
`type`, `title`, `status`, `detail`, `instance`, `timestamp`; validaciones añaden
`errors: [{field, message}]`. Order añade `code` y `traceId` para errores de dominio;
clientes deben tolerar que errores de seguridad/Gateway no tengan esas extensiones.
`instance` puede ser la ruta interna sin `/v1`. No incluir tokens ni stack traces.

| HTTP | Casos principales |
| --- | --- |
| 400 | JSON/campos/clave inválidos, ofertas duplicadas, cantidades fuera de rango, QR inválido. |
| 401 | JWT ausente, inválido o vencido. |
| 403 | Rol no permitido, cajero sin asignación. |
| 404 | Recurso inexistente/ajeno o pago todavía no creado. |
| 409 | Stock/oferta/precio, transición inválida, pago existente, idempotencia o QR usado/vencido. |
| 415 | Cuerpo enviado con un Content-Type distinto de `application/json`. |
| 503 | Dependencia no disponible/compensación pendiente; reintentar con misma clave. |

Ejemplo de stock insuficiente al confirmar:

```json
{
  "type": "about:blank",
  "title": "Conflict",
  "status": 409,
  "detail": "No hay stock suficiente para reservar la orden completa.",
  "instance": "/orders/40000000-0000-4000-8000-000000000001/confirmar",
  "timestamp": "2026-10-15T18:01:00Z",
  "code": "STOCK_INSUFICIENTE",
  "traceId": "aabbccddeeff00112233445566778899"
}
```

## Eventos RabbitMQ y WebSocket

Exchange durable existente `cloudcoffee.events` (topic); routing key igual a
`eventType`. Mantener el envelope actual `CloudCoffeeEvent`:

```json
{
  "eventId": "70000000-0000-4000-8000-000000000001",
  "timestamp": "2026-10-15T18:02:00Z",
  "traceId": "aabbccddeeff00112233445566778899",
  "eventType": "order.orden.estado-cambiado.v1",
  "payload": {
    "compraId": "30000000-0000-4000-8000-000000000001",
    "ordenId": "40000000-0000-4000-8000-000000000001",
    "clienteId": "10000000-0000-4000-8000-000000000001",
    "cafeteriaId": "20000000-0000-4000-8000-000000000001",
    "estadoAnterior": "pagado",
    "estado": "listo_para_retiro",
    "version": 3
  }
}
```

Campos payload obligatorios por evento (`version` pertenece al recurso indicado):

| Productor / eventType | Payload |
| --- | --- |
| Order / `order.compra.creada.v1` | `compraId, clienteId, estado, montoTotal, moneda, ordenIds, version` (compra). |
| Order / `order.compra.estado-cambiado.v1` | `compraId, clienteId, estadoAnterior, estado, montoTotal, moneda, version` (compra). |
| Order / `order.pago.resultado.v1` | `pagoId, compraId, clienteId, estado, motivo, montoTotal, moneda, simulado: true, version` (pago); se emite al iniciar pendiente y al resolver. |
| Order / `order.orden.estado-cambiado.v1` | `compraId, ordenId, clienteId, cafeteriaId, estadoAnterior, estado, version` (orden). |
| Order / `order.orden.entregada.v1` | `compraId, ordenId, clienteId, cafeteriaId, entregadoAt, version` (orden); comparte versión con el cambio a entregado, tiene distinto eventId. |
| Catalog / `catalog.stock.actualizado.v1` | `ofertaId, productoId, cafeteriaId, campusId, stockActual, version` (oferta). `stockActual` es disponibilidad vendible tras reserva/liberación. |

Al crear cada orden también se emite `order.orden.estado-cambiado.v1` con
`estadoAnterior: null` y `version: 1`, para que el cajero descubra pedidos nuevos.
Los cambios posteriores usan un estado anterior de la tabla. Cambiar el total de
una compra al cancelar una orden también emite su evento, aunque conserve el
estado (`estadoAnterior == estado`), con una versión mayor.

`eventId` UUID se crea una vez por hecho; `timestamp` es cuándo ocurrió en UTC;
`traceId` es el trace de la operación original, preservado al reintentar. Jobs sin
HTTP abren su propio trace. No publicar sin trace ni inventar uno a partir de IDs
de negocio. Guardar evento/outbox en la misma transacción del estado (INT2-64).
Publicar con confirmación del broker; ante caída/reinicio repetir el mismo evento.
Consumidores deduplican por `(consumidor, eventId)` en la transacción de su efecto.
Entrega al menos una vez; no se presupone orden global ni entrega exactamente una vez.
Reintentos agotados usan DLQ existente; falla de correo nunca revierte una compra.

Ejemplo de pago rechazado y stock liberado en
[compra-pago-retiro.eventos.json](compra-pago-retiro.eventos.json).

INT2-80 expondrá STOMP sobre SockJS en `/v1/notifications/ws`. JWT en header
`Authorization` de `CONNECT`, nunca en query. Validar cada `SUBSCRIBE` contra
identidad/asignación y cerrar al vencer JWT; denegar `SEND` de clientes a destinos
de negocio. Destinos y payloads:

| Destino | Acceso / contenido |
| --- | --- |
| `/topic/orden/{ordenId}/estado` | Propietario o cajero de la cafetería; envelope de `order.orden.estado-cambiado.v1`. |
| `/topic/compra/{compraId}/estado` | Propietario; envelopes de compra y pago para esa compra. |
| `/topic/cafeteria/{cafeteriaId}/ordenes` | Solo cajero asignado; envelope de cambios de órdenes, permite descubrir pedidos nuevos. |
| `/topic/cafeteria/{cafeteriaId}/stock` | CLIENTE autenticado o cajero asignado; envelope de stock sin datos personales. |

No usar un comodín para eludir permisos. Al conectar/reconectar, suscribir primero,
releer por HTTP compras/órdenes y combinar por versión; ignorar eventos duplicados
o anteriores y releer ante saltos. Stock se reconcilia con consultas existentes del
Catálogo. No usar estado del QR ni del cliente como prueba de pago o entrega.

## Ejemplo HTTP de compra y retiro

Usar un JWT de cliente verificado y dos ofertas activas del seed; cada mutación
nueva requiere su propia clave. IDs/códigos del OpenAPI son ficticios. Sustituir
host/protocolo por el Gateway configurado, HTTPS en producción.

```http
POST /v1/compras
Authorization: Bearer <jwt-cliente>
Idempotency-Key: 80000000-0000-4000-8000-000000000001
Content-Type: application/json

{"items":[{"ofertaId":"50000000-0000-4000-8000-000000000001","cantidad":2}]}
```

`201 Compra`: una orden `pendiente_pago`, 2 × 1800 = 3600 CLP, `pago: null`.
Con falta de stock, `201 Compra` en revisión: mostrar las órdenes afectadas antes
de confirmar/cancelar. No volver a crear automáticamente.

```http
POST /v1/compras/30000000-0000-4000-8000-000000000001/pago
Authorization: Bearer <jwt-cliente>
Idempotency-Key: 80000000-0000-4000-8000-000000000002
Content-Type: application/json

{"escenario":"aprobar"}
```

`201 Pago` aprobado por 3600 CLP, `simulado: true`. Consultar compra/orden para estado
actual. El cajero marca `/orders/{ordenId}/listo` con su JWT y otra clave; el dueño
consulta `/orders/{ordenId}/qr` y muestra `codigo` hasta `expiraAt`. El cajero envía
`{codigo}` a `/orders/validar-retiro` y luego a `/orders/{ordenId}/entregar` con otra
clave. Se obtiene `200 Orden` entregada. Repetir la entrega con la misma clave
devuelve el éxito previo; una lectura nueva del QR devuelve `409 QR_UTILIZADO`.

## Compatibilidad y siguientes implementaciones

Los clientes móviles existentes son consumidores de supuestos previos, no de
endpoints Order ya publicados. Requieren adaptación coordinada antes de integrar:

* `services/pagos.ts`: sustituir Mercado Pago, estados con espacios/acentos e
  `initPoint` por pago simulado, estados snake_case y claves de idempotencia.
  Eliminar `datosEntrega` del comando; la identidad sale del JWT.
* `services/compras.ts`: usar página con `content` en vez de `Compra[]`, añadir
  consulta individual y paginación; `domain.ts` debe incorporar revisión/pago por
  orden. Confirmar corresponde a revisión, no a una compra ya reservada.
* `services/qrRetiro.ts`: sustituir `{pedido, estado}` autogenerado por token opaco
  del servidor. Entregar requiere `{codigo}` y autorización persistida.
* `services/websocket.ts`: leer envelope/payload/version y controlar permisos,
  reconexión y vencimiento; no esperar eventos planos `{ordenId, estado}`.

Estas adaptaciones y las APIs ejecutables pertenecen a sus issues; INT2-50 aporta
una referencia única sin modificar pantallas ni flujos actuales.

## Validar la definición HTTP

Desde la raíz, con `openapi-spec-validator` instalado en un entorno temporal:

```bash
python -m openapi_spec_validator backend/docs/compra-pago-retiro.openapi.json
```

La validación de esta entrega también comprobó los ejemplos contra los schemas,
incluidos formatos de UUID/fecha y longitud del código de retiro. No es una prueba
de endpoints ejecutables; las siguientes issues deberán implementar los escenarios.

## Escenarios que las implementaciones deben verificar

1. Dos cafeterías: stock suficiente → dos órdenes, suma exacta y una compra/pago.
2. Una cafetería sin stock → revisión solo de esa orden, ninguna reserva parcial;
   cancelar esa orden permite pagar las restantes por el total recalculado.
3. Reintentos concurrentes, reinicio y misma clave → una compra, un pago, un efecto
   sobre stock; distinta carga con misma clave → conflicto.
4. Precio cambió durante revisión → cotización visible y nueva confirmación;
   ningún importe/estado del frontend altera el pago.
5. Aprobado/rechazado/pendiente deterministas; pendiente expira a los 15 minutos;
   carrera aprobación/cancelación/expiración no confirma y libera la misma reserva.
6. Propietario ajeno, cajero sin asignación o de otra cafetería → denegado tanto
   por HTTP como por suscripción; JWT vencido desconecta WebSocket.
7. QR impago, ajeno, vencido, alterado y reutilizado → rechazo; dos entregas
   concurrentes registran solo una, sin repetir descuento de stock.
8. Caída del broker tras persistir y antes de publicar → recuperación con eventId
   estable; consumidor duplicado no repite correo/efecto; HTTP reconcilia el estado.
