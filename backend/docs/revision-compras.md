# Confirmar y cancelar compras sin pago · INT2-73

Esta entrega permite resolver compras por disponibilidad, antes de iniciar un pago.
Implementa los criterios de INT2-73 y las reglas de revisión/idempotencia del contrato
INT2-50. El alcance acordado excluye actuar sobre pagos: **cualquier pago existente**
(pendiente, aprobado o rechazado) hace responder `409 ESTADO_INVALIDO` en las cuatro
acciones, sin cambiar el pago ni liberar sus reservas. Cancelar compras con pago
pendiente e integrar sus resultados queda para INT2-77.

## Rutas y permisos

| Ruta pública | Resultado |
| --- | --- |
| `POST /v1/compras/{compraId}/confirmar` | Reintenta todas las órdenes en revisión; `200 Compra`. |
| `POST /v1/compras/{compraId}/cancelar` | Cancela las órdenes activas, libera reservas y deja total cobrable 0; `200 Compra`. |
| `POST /v1/orders/{ordenId}/confirmar` | Reintenta una orden en revisión y actualiza también la compra; `200 Orden`. |
| `POST /v1/orders/{ordenId}/cancelar` | Cancela una orden, libera su reserva y recalcula la compra; `200 Orden`. |

Todas requieren JWT de CLIENTE propietario e `Idempotency-Key` UUID. No admiten
cuerpo, ni siquiera `{}`; el comando queda definido por su ruta. Gateway elimina
solo `/v1`. Respuestas de negocio usan `Cache-Control: no-store`. Recurso ajeno e
inexistente responden el mismo `404`; otro rol obtiene `403`.

```http
POST /v1/orders/<ordenId-en-revision>/confirmar
Authorization: Bearer <jwt-cliente>
Idempotency-Key: 80000000-0000-4000-8000-000000000073
```

Los ejemplos de creación y las ofertas del seed están en [INT2-71](creacion-compras.md).
Cada nueva intención usa otra clave; ante timeout o `503`, conservar la misma.

## Confirmación y cotización

Solo confirma órdenes en `revision_requerida`, con compra en revisión/pendiente,
sin pago y antes de `reservaExpiraAt`. Las órdenes ya reservadas no se recotizan ni
se vuelven a reservar. El plazo común de creación no se extiende.

Se consulta Catalog para las ofertas de las órdenes afectadas. Si cambió el precio,
actualiza sus snapshots provisionales, totales y versiones, permanece en revisión
y devuelve `409 PRECIO_CAMBIO` con la `compra` actualizada en el Problem Details.
No reserva stock en esa respuesta. El comprador debe revisar la cotización y
confirmar con otra clave. Esto también cubre un precio que cambia entre cotizar y
reservar: primero compensa el intento y después vuelve a leer la cotización.

Si falta stock, devuelve `409 STOCK_INSUFICIENTE` y libera **todas las reservas
nuevas de esa confirmación**, incluidas las de otras órdenes seleccionadas en la
confirmación completa. Conserva las reservas anteriores de órdenes ya pendientes
de pago. La compra y sus snapshots quedan sin cambios. Un nuevo intento usa una
clave y un attemptId nuevos; no revive las reservas liberadas de un intento previo.

Ofertas no disponibles, campus mezclados o cambios de cafetería se rechazan. Los
totales se validan antes de reservar o escribir snapshots, con CLP entero y máximo
2.000.000.000, sin agregar impuestos ni recargos.

## Cancelación

Solo cancela órdenes en revisión/pendientes de una compra sin pago. La cancelación
individual conserva su monto e ítems históricos, pero los excluye del total cobrable
de la compra. Si no quedan órdenes activas, la compra pasa a `cancelado` y total 0.
Cancelar toda la compra conserva igualmente sus snapshots y libera las referencias
de reserva vigentes. Ningún estado terminal se reactiva.

Una reserva liberada o expirada se puede liberar otra vez sin repetir el efecto.
Una dependencia que no confirme el resultado deja la cancelación pendiente; no
afirma éxito mientras todavía haya stock por liberar.

## Exclusión, recuperación y eventos

V6 añade `revisiones_compra` con espacio de idempotencia por usuario/ruta/clave y
un diario privado de pasos. La misma intención terminada reproduce exactamente
código/cuerpo con `Idempotency-Replayed: true`, incluso tras cambios posteriores;
otra ruta tiene su propio espacio. Los errores definitivos también se conservan.
La validación de JWT, propietario, cuerpo y clave precede al registro de la intención.

Cada paso bloquea la compra con `FOR UPDATE NOWAIT`. La marca
`compras.revision_pendiente` mantiene la exclusión entre pasos y después de una
caída. Otro comando recibe `409 IDEMPOTENCY_IN_PROGRESS`; un fallo de dependencia,
`503 OPERACION_PENDIENTE`; ambos indican `Retry-After: 2`. No son resultados finales.

El worker reanuda tras reinicio con las mismas identidades de orden/oferta/intento,
incluidas respuestas perdidas de reserva, liberación y compensación. Solo libera
reservas del intento en curso al fallar una confirmación. Una confirmación que
vence compensa ese intento y devuelve `409 RESERVA_VENCIDA`, sin ampliar el plazo.
La expiración automática del agregado y su integración con pagos quedan fuera de
esta entrega, en las transiciones de INT2-77.

El inicio de pago toma el mismo bloqueo de compra y comprueba esa marca y el estado
pendiente antes de llamar a la pasarela. Así no puede iniciarse mientras se confirma
o cancela, ni después de cancelar. Esta es una protección de concurrencia: no cambia
resultados, estados ni reservas de pagos existentes.

Cambios de recursos, versiones, respuesta idempotente y eventos se confirman en la
misma transacción local. Se emiten `order.orden.estado-cambiado.v1` y
`order.compra.estado-cambiado.v1` con el traceId original y versiones de los recursos.
También se publica el cambio de total al cancelar una orden aunque el estado de
compra se conserve. Se reutiliza el outbox y publicador de INT2-71; un replay no
genera otro eventId ni repite efectos.

## Pruebas y migración

```sh
JAVA_HOME=<JDK21> ./backend/auth-service/mvnw -f backend/pom.xml -pl order-service -am clean verify
```

Las pruebas usan JWT firmado, migraciones y persistencia real en H2/PostgreSQL 16,
con un puerto Catalog controlado para provocar fallos de infraestructura. Incluyen
aislamiento, precios concurrentes, compensación de varias órdenes, replay de errores
y éxitos, eventos/versiones, reinicios y carreras con inicio de pago. Los casos con
pagos existentes verifican que sus filas no se modifiquen.

V6 es aditiva y no cambia V1–V5. Para revertir una base efímera: detener workers,
resolver las revisiones pendientes, respaldar el diario y quitar primero
`fk_compra_revision`, después `idx_compra_revision_pendiente` y la columna
`revision_pendiente`, y por último `revisiones_compra`. Una base compartida requiere
una migración posterior; no borrar decisiones pendientes ni editar migraciones
ya aplicadas.
