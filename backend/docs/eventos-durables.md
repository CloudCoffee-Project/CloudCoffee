# Eventos durables de Order y Catalog · INT2-64

## Garantía y transacciones

El cambio de negocio y el envelope se guardan en **la misma transacción local**:
Order usa `order_outbox` y Catalog usa `catalog_outbox` (migración V6). Si falla el
append o se revierte la transacción, se revierte también el cambio de negocio.
No hay transacciones entre servicios ni llamadas RabbitMQ desde una reserva de stock.

Los publicadores seleccionan solo filas confirmadas desde una transacción
`REQUIRES_NEW`, independiente del llamador. Cada fila se bloquea mediante
`FOR UPDATE SKIP LOCKED` hasta terminar el intento. Dos réplicas pueden avanzar
en filas distintas, pero no reclaman simultáneamente la misma fila. Se envía el
envelope original como JSON UTF-8, con mensaje persistente y `messageId=eventId`.

Solo se marca `publicado=true` después de publisher confirm positivo y ausencia
de devolución mandatory. Nack, timeout de confirmación (2 s), fallo de conexión,
mensaje sin ruta o rollback de la marca dejan la fila pendiente. El siguiente
ciclo o una nueva instancia vuelve a enviar **los mismos bytes**: conserva
`eventId`, `timestamp`, `traceId`, versión, snapshots y destinatarios.

La garantía es **al menos una vez**, no exactamente una vez: si RabbitMQ recibe
el mensaje y se pierde la confirmación, o el proceso cae antes del commit de la
marca, puede recibirlo nuevamente. La publicación no vuelve a ejecutar reservas,
pagos u otras acciones de negocio. Los consumidores deben deduplicar el efecto
por `(consumidor, eventId)` en su propia transacción durable.

La confirmación del broker no acredita que un consumidor haya procesado el
evento. El exchange es durable; la durabilidad final también requiere colas
durables en los consumidores y almacenamiento/configuración adecuados del broker.
Los reintentos/DLQ de consumidores siguen su topología existente. La salida local
no descarta pendientes ni los mueve a una DLQ tras un número arbitrario de intentos.

## Puntos de escritura y auditoría

| Flujo | Escritura y estado de implementación |
| --- | --- |
| Creación de compra/órdenes | `DiarioCreacion` usa `OrderEventJournal`, en la transacción que materializa recursos y respuesta idempotente. |
| Revisión/confirmación/cancelación | `EventosRevision` usa el mismo journal y tabla. |
| Resultado de pago y cambios asociados | `ResultadoPagoService` conserva `EventosRevision`; la transacción de pago y decisión escribe el outbox existente. |
| Preparación, entrega y no retirados | Las transiciones aún pertenecen a INT2-54/79/126/127. Deben reutilizar `OrderEventJournal` y `EventosRevision.orden` dentro del commit de estado; no crear otro publicador. |
| Reserva, liberación y vencimiento de stock | `StockEventPublisher` toma el snapshot y escribe mediante `CatalogEventJournal`, dentro de la transacción de `StockReservationService`. Un replay de reserva/liberación no crea otro efecto ni evento. |
| Eventos dirigidos de Catalog | El journal admite el envelope con destinatarios ya resueltos y los conserva al reintentar. La selección de seguidores y generación de reposición se implementan en INT2-117. |

Ambos journals exigen una transacción existente (`MANDATORY`): no abren una
transacción independiente para guardar el evento. Antes de construir un snapshot
de una entidad JPA, hacer flush si cambió su versión. Reserva usa actualización
atómica y refresh; liberación/vencimiento ya hacen flush antes del evento. Las
nuevas escrituras de inventario deben respetar esa secuencia.

Ejemplo para una transición futura de Order:

```java
// Dentro de la misma transacción que actualiza la orden y su respuesta idempotente.
entityManager.flush();
journal.append("order.orden.entregada.v1", payload, traceOriginal, ocurridoAt);
```

Para Catalog, construir `CloudCoffeeEvent` una sola vez y llamar
`journal.append(event)` en la transacción de negocio. Los destinatarios de un evento
dirigido se guardan dentro de su payload privado; no se agregan al evento público
de stock ni se recalculan en cada reintento. Cada hecho tiene su propio UUID.
La traza del hecho queda fijada al escribir y no se sustituye por la del publicador.

## Orden y reconciliación

`created_at,event_id` establece el orden de selección; no garantiza orden global
de entrega entre réplicas. Un consumidor debe ignorar duplicados/versiones antiguas
y reconciliar por HTTP ante saltos de versión, como exige el contrato de compra.
Un fallo puede ocasionar redelivery y llegada fuera de orden; no descontar stock
ni registrar una entrega basándose solo en recibir el mensaje otra vez.

Los publicadores procesan hasta 20 filas por ciclo y detienen el lote ante un
fallo para evitar un bucle intensivo contra un broker caído. Un mensaje sin binding
permanece pendiente: corregir la topología y dejar que reintente. No marcarlo a mano
como publicado para silenciar la alerta.

## Configuración y operación

| Servicio | Propiedad | Valor predeterminado |
| --- | --- | --- |
| Order | `cloudcoffee.creation.publish-enabled` | `true` |
| Order | `cloudcoffee.creation.publish-ms` | `2000` |
| Catalog | `catalog.outbox.publish-enabled` / `CATALOG_OUTBOX_PUBLISH_ENABLED` | `true` |
| Catalog | `catalog.outbox.publish-ms` / `CATALOG_OUTBOX_PUBLISH_MS` | `2000` |

En ambos servicios están habilitados `publisher-confirm-type=correlated`,
`publisher-returns=true` y `template.mandatory=true`. No desactivar esas opciones:
un ACK sin mandatory podría corresponder a un mensaje sin cola destinataria.
Deshabilitar el publicador conserva las escrituras y acumula pendientes; al
rehabilitarlo se recuperan. Los tests lo deshabilitan y lo invocan explícitamente.

Consultar pendientes en la base propia de cada servicio:

```sql
SELECT event_id, event_type, created_at
FROM catalog_outbox WHERE publicado = FALSE
ORDER BY created_at, event_id;
-- En la base de Order usar order_outbox con las mismas columnas.
```

Tras reiniciar, comprobar reducción de pendientes y logs de conexión, confirmación
y bindings. No editar el envelope ni generar UUID nuevos para repetir un envío.
La limpieza/retención de filas publicadas queda fuera de INT2-64. Payment conserva
su infraestructura propia; esta entrega no modifica su journal ni su publicador.

## Verificación reproducible

Desde `backend/`, con Java 21:

```bash
./auth-service/mvnw --batch-mode --no-transfer-progress -pl catalog-service,order-service -am verify
```

Las pruebas de los dos servicios cubren: transacción obligatoria; rollback;
ausencia de publicación de datos sin commit; fallo del broker; confirmación
perdida; nack; mandatory return; caída después de la aceptación; recreación del
publicador; dos réplicas; conservación del envelope. Catalog verifica además
stock/versión/evento atómicos, error SQL al guardar evento, vencimiento y replays
concurrentes de la misma reserva.

Para repetir contra PostgreSQL, proporcionar `SPRING_DATASOURCE_URL`,
`SPRING_DATASOURCE_USERNAME` y `SPRING_DATASOURCE_PASSWORD` de una **base de prueba
distinta por servicio**, y ejecutar cada módulo por separado. Estas suites escriben
datos de prueba y pueden marcar filas históricas de outbox como publicadas para
aislar los escenarios; no se ejecutan contra bases de desarrollo con datos útiles.

Con `RABBIT_INTEGRATION_TEST=true` y `SPRING_RABBITMQ_*`, se habilitan también las
pruebas del broker real: confirmación, preservación de cuerpo/ID/traza y retorno
sin binding. Catalog incluye conexión real no disponible y recuperación al
restaurar el transporte. Cada test usa su propio exchange/cola, eliminados al salir.
CI ejecuta ahora también Catalog dentro del job RabbitMQ existente.
