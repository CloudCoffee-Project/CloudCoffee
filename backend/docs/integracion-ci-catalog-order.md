# Integración de Catalog y Order con RabbitMQ en CI

INT2-103 valida el flujo final de pago simulado con PostgreSQL 16 y RabbitMQ 3.13
reales de prueba. No usa Mercado Pago, credenciales, preferencias, callbacks ni
webhooks externos.

## Cobertura del job

El job `RabbitMQ event flow` conserva Auth y Notification y agrega bases aisladas
para evitar que los historiales Flyway de distintos servicios compartan un schema:

| Servicio | Base | Cobertura |
| --- | --- | --- |
| Auth | configuración de pruebas | publicación existente |
| Notification | `cloudcoffee_test` | consumo y persistencia existentes |
| Catalog | `cloudcoffee_catalog_integration` | migraciones, outbox, confirmaciones y reintento |
| Order | `cloudcoffee_order_integration` | migraciones, pago simulado y outbox idempotente |
| Payment | H2 de pruebas | suite histórica; proveedor deshabilitado |

Order se ejecuta con:

```dotenv
ORDER_PAYMENT_PROVIDER=simulado
PAYMENT_PROVIDER=disabled
```

La prueba `SimulatedPaymentRabbitIntegrationTests` crea una compra, solicita el
escenario `aprobar`, comprueba el pago persistido y publica los eventos
`order.pago.resultado.v1` y `order.compra.estado-cambiado.v1`. Un segundo barrido
del outbox no debe entregar mensajes adicionales.

## Reproducción local rápida

Requiere Java 21, Docker y los puertos `25432` y `25672` libres. Desde la raíz:

```bash
docker network create cloudcoffee-int2103
docker run --detach --name cloudcoffee-int2103-postgres \
  --network cloudcoffee-int2103 --publish 25432:5432 \
  --env POSTGRES_DB=cloudcoffee_order_integration \
  --env POSTGRES_USER=cloudcoffee \
  --env POSTGRES_PASSWORD=cloudcoffee_test \
  postgres:16-alpine
docker run --detach --name cloudcoffee-int2103-rabbitmq \
  --network cloudcoffee-int2103 --publish 25672:5672 \
  --env RABBITMQ_DEFAULT_USER=cloudcoffee \
  --env RABBITMQ_DEFAULT_PASS=cloudcoffee_test \
  rabbitmq:3.13-alpine
```

Esperar que ambos procesos respondan:

```bash
docker exec cloudcoffee-int2103-postgres \
  pg_isready -U cloudcoffee -d cloudcoffee_order_integration
docker exec cloudcoffee-int2103-rabbitmq rabbitmq-diagnostics -q ping
```

Ejecutar la prueba integrada:

```bash
cd backend
RABBIT_INTEGRATION_TEST=true \
SPRING_RABBITMQ_HOST=localhost \
SPRING_RABBITMQ_PORT=25672 \
SPRING_RABBITMQ_USERNAME=cloudcoffee \
SPRING_RABBITMQ_PASSWORD=cloudcoffee_test \
SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:25432/cloudcoffee_order_integration \
SPRING_DATASOURCE_USERNAME=cloudcoffee \
SPRING_DATASOURCE_PASSWORD=cloudcoffee_test \
ORDER_PAYMENT_PROVIDER=simulado \
PAYMENT_PROVIDER=disabled \
./auth-service/mvnw --batch-mode --no-transfer-progress \
  -pl order-service -am \
  -Dtest=SimulatedPaymentRabbitIntegrationTests \
  -Dsurefire.failIfNoSpecifiedTests=false test
```

Al terminar, eliminar solo la infraestructura temporal:

```bash
docker rm --force cloudcoffee-int2103-postgres cloudcoffee-int2103-rabbitmq
docker network rm cloudcoffee-int2103
```

## Equivalencia completa con CI

El workflow ejecuta `clean verify` para cada módulo, no solamente la prueba rápida:

```bash
./auth-service/mvnw --batch-mode --no-transfer-progress \
  -pl catalog-service -am clean verify
./auth-service/mvnw --batch-mode --no-transfer-progress \
  -pl order-service -am clean verify
```

Para reproducirlos deben suministrarse las mismas variables de PostgreSQL y RabbitMQ
del ejemplo, usando una base vacía distinta para cada servicio. GitHub Actions muestra
el resultado de cada alcance en `$GITHUB_STEP_SUMMARY`; una migración, publicación o
aserción fallida deja el job en rojo.

Los cambios en `backend/**` o `.github/workflows/backend-ci.yml` activan el workflow.
La suite histórica de `payment-service` se conserva, pero no es una dependencia del
flujo de aceptación con pago simulado en Order.
