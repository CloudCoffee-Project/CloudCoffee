# Creación de compras · INT2-71

`POST /v1/compras` (Gateway elimina `/v1`) requiere JWT de `CLIENTE` y
`Idempotency-Key` UUID. La identidad se toma exclusivamente de `sub`.

```http
POST /v1/compras
Authorization: Bearer <jwt-cliente>
Idempotency-Key: 80000000-0000-4000-8000-000000000001
Content-Type: application/json

{"items":[{"ofertaId":"55555555-5555-4555-8555-555555555501","cantidad":2},{"ofertaId":"55555555-5555-4555-8555-555555555508","cantidad":1}]}
```

Con el seed de Catalog (`CATALOG_SPRING_PROFILES=docker,dev`), crea dos órdenes,
una por cafetería, por 4300 CLP. Responde `201 Compra`, `Location` apuntando a
`/v1/compras/{compraId}` y `Cache-Control: no-store`. Incluye los snapshots de
productos/precios, `pago: null`, versión 1 y vencimiento común a los 15 minutos
desde el inicio de la operación. El precio incluye impuestos; no se agrega IVA,
despacho ni recargos.

El cuerpo admite únicamente `items`, de 1 a 100 ofertas distintas, y cada ítem
únicamente `ofertaId` UUID y `cantidad` entera de 1 a 100. Propietario, importes,
estado, cafetería y `datosEntrega` suministrados por el cliente son rechazados
con `400`. Cantidades, claves y JSON inválidos no consumen la clave.

## Disponibilidad y compensación

Order consulta una cotización interna en Catalog. Oferta desconocida, producto
inactivo, cafetería cerrada o campus mezclados devuelve `409
OFERTA_NO_DISPONIBLE`, sin persistir una compra ni reservar stock. El total debe
ser entero en CLP y no superar 2.000.000.000; se valida antes de reservar.

La reserva comprueba el precio cotizado y la disponibilidad dentro del bloqueo
de Catalog que descuenta stock. Si falta stock en un ítem, se liberan todas las
reservas nuevas de **esa cafetería**, se conserva su cotización provisional y la
orden queda en `revision_requerida`. Las otras cafeterías conservan sus reservas
y quedan en `pendiente_pago`. La compra se devuelve igualmente con `201` y estado
`revision_requerida` si tiene alguna orden en revisión. Nunca reduce cantidades
ni sustituye ofertas silenciosamente.

Ejemplo: agregar al cuerpo anterior la oferta agotada
`55555555-5555-4555-8555-555555555503` con cantidad 1 deja Central en revisión
(restaura sus dos americanos) y mantiene la reserva de Biblioteca.

Si una oferta cambia de precio/actividad mientras se reserva, se compensan las
reservas de toda esta creación antes de conservar un `409 OFERTA_NO_DISPONIBLE`.
Si una creación todavía incompleta alcanza su plazo, se compensan sus reservas
y se conserva `409 RESERVA_VENCIDA`; un reintento no extiende el plazo.

## Idempotencia y recuperación

`creacion_compras` tiene un espacio exclusivo para `POST /compras` y una
restricción única por usuario/clave. El cuerpo se normaliza ordenando por oferta
y se guarda su SHA-256. La misma clave con otro contenido devuelve `409
IDEMPOTENCY_CONFLICT`; otro usuario tiene su propio espacio.

Una respuesta terminada, incluidos los errores de negocio definitivos, se
reproduce byte por byte con su código, `Location` e `Idempotency-Replayed: true`.
Cambios posteriores de catálogo o compra no alteran ese snapshot; consultar el
`GET` del recurso para obtener el estado actual. No se purgan registros
automáticamente: se conservan por más del mínimo contractual de 24 horas.

Antes de llamar a Catalog se persisten las identidades estables de compra,
órdenes, ítems e intento. Cada paso bloquea únicamente el diario de esa operación
con `FOR UPDATE NOWAIT` y confirma su progreso local. Los reintentos concurrentes
reciben `409 IDEMPOTENCY_IN_PROGRESS` y `Retry-After: 2` si otro worker tiene el
bloqueo. Un timeout o respuesta de dependencia no verificable devuelve `503
OPERACION_PENDIENTE`, con el mismo `Retry-After`; no se guarda como resultado final.

Si Catalog reservó o liberó pero se perdió la respuesta, se repite el mismo
comando interno. La reserva se identifica por orden/oferta/intento y la liberación
por reserva. La decisión de compensar se persiste antes de liberar. Así también
se recupera una caída del proceso entre el efecto remoto y el commit local.
El worker reanuda automáticamente operaciones pendientes tras reinicio; no
depende de que el comprador vuelva a abrir la app.

Compra/órdenes/ítems, referencias de reservas vigentes (`orden_reservas`),
respuesta idempotente y eventos de creación se insertan en una sola transacción
local, después de resolver reservas/compensaciones. Una compra incompleta no
aparece en historial ni puede iniciar un pago.

## Eventos y configuración

La creación guarda `order.compra.creada.v1` y un
`order.orden.estado-cambiado.v1` por orden en `order_outbox`, con el envelope del
contrato, versión 1, `estadoAnterior: null` y traceId original. La publicación
usa mensajes persistentes, confirmación del broker y detección de devoluciones
sin ruta. Un evento solo se marca publicado tras confirmación; ante caída o
reinicio se vuelve a enviar el mismo eventId. Los consumidores deben deduplicar.
Esta entrega cubre los eventos de **creación**; las transiciones futuras y la
generalización del mecanismo siguen en sus tareas (incluida INT2-64).

Docker Compose configura para Order `CATALOG_SERVICE_URL`, el token interno
compartido y RabbitMQ. No se envía el JWT del comprador a las rutas internas.
Catalog añade `POST /internal/servicios/catalogo/cotizaciones` y admite
`expiresAt`/`expectedPrice` opcionales al reservar. Order envía el vencimiento
común; clientes internos anteriores conservan sus constructores y TTL anteriores.

Parámetros opcionales: `cloudcoffee.catalog.timeout` (PT2S),
`cloudcoffee.creation.scan-ms` (2000), `cloudcoffee.creation.publish-ms` (2000).
En tests se pueden desactivar los workers con
`cloudcoffee.creation.recovery-enabled=false` y
`cloudcoffee.creation.publish-enabled=false`.

La expiración de compras **ya terminadas**, confirmar/cancelar y la aplicación de
pago sobre órdenes/reservas se implementan en INT2-73/77. Esta entrega no añade
pago, QR ni cambios de pantallas móviles.

## Validación

```sh
JAVA_HOME=<JDK21> ./backend/auth-service/mvnw -f backend/pom.xml -pl order-service,catalog-service -am clean verify
```

Las pruebas HTTP de Order usan JWT firmado, migraciones y persistencia real, con
un puerto Catalog controlado para inyectar respuestas perdidas, concurrencia y
caídas. Catalog prueba sus reservas/cotizaciones con base real. Ambos se ejecutan
en H2 y PostgreSQL 16. El cliente interno tiene pruebas HTTP con servidor local.

`OrderOutboxRabbitIntegrationTests` se habilita con `RABBIT_INTEGRATION_TEST=true`
y las variables `SPRING_RABBITMQ_*`; comprueba confirmaciones reales y que una
devolución sin binding no se marque publicada. Backend CI lo ejecuta en su job
RabbitMQ. Las pruebas de caída del broker también comprueban que los eventos
persistidos conservan su identidad al reintentar.

## Migración y reversión

V5 es aditiva; no modifica migraciones existentes ni datos históricos. Antes de
revertir una instalación con tráfico, detener nuevas creaciones y workers,
resolver todas las operaciones pendientes, publicar los eventos y respaldar el
diario y las referencias de reserva. No eliminar estos registros mientras haya
stock pendiente de compensar o reservas que necesiten las siguientes transiciones.

En una base efímera o sin tráfico, el esquema añadido se revierte en orden con
`DROP TABLE order_outbox; DROP TABLE orden_reservas; DROP TABLE creacion_compras;`.
Flyway no ejecuta automáticamente este rollback; en una base compartida se hace
mediante una migración posterior, preservando el historial de versiones.
