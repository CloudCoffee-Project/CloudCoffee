# Payment Service · INT2-110

Módulo Spring Boot 4.0.8 / Java 21 del reactor backend, con `common-security`,
`common-errors`, Flyway, PostgreSQL, RabbitMQ, Actuator y Zipkin.

## Estado y límites de la entrega

Esta issue entrega estructura, persistencia y ejecución integrada. El contrato
objetivo está en [Payment INT2-108](../docs/payment-service.md). Preferencias,
verificación de firmas, conciliación/publicación y consumo por Order se implementan
en INT2-111/112/113. No hay llamadas a Mercado Pago ni nuevas APIs de pago ejecutables.
La configuración exige `PAYMENT_PROVIDER=disabled` y rechaza cualquier otro valor
para evitar activar accidentalmente un adaptador que todavía no existe.

El único endpoint de negocio expuesto por Gateway es
`POST /v1/payments/webhooks/mercadopago`. Payment recibe
`POST /payments/webhooks/mercadopago` y responde **503 PAYMENT_NOT_ENABLED**, sin
aceptar ni persistir notificaciones. `Retry-After: 2` permite al proveedor reintentar.
INT2-112 debe reemplazar ese límite por validación de firma e inbox durable antes
de habilitar el proveedor. No confundir salud del módulo con integración de pago lista.

Las rutas `/internal/servicios/**` usan `X-Internal-Service-Token` (mínimo 32
caracteres) mediante el filtro compartido; un JWT SUPER_ADMIN no las autoriza.
Gateway no las publica. No hay controlador de preferencias hasta INT2-111.
Payment solo recibe la llave JWT pública, nunca la privada de Auth.

## Persistencia

V1 crea cinco tablas, sin semillas y sin referencias a bases ajenas:

| Tabla | Invariantes y uso previsto |
| --- | --- |
| `payment_intent` | Una compra y clave de idempotencia únicas, hash/payload de intención, CLP, entorno sandbox, expiración y versión. |
| `payment_preference` | Una preferencia por intención; identificador externo único y checkout persistido. |
| `provider_payment` | Múltiples pagos externos auditables por preferencia/intención; ID externo único. |
| `payment_inbox` | Deduplicación por proveedor/notificación, payload saneado y recuperación de pendientes. |
| `payment_outbox` | Event ID estable y unicidad por intención/versión/tipo, publicación y reintento pendientes. |

`compra_id` y `cliente_id` son valores externos; las FK solo conectan tablas de
Payment. Constraints validan importes, estados, timestamps de procesamiento y
unicidad; índices cubren conciliación, vencimiento, FK y pendientes por reintentar.
El código futuro debe actualizar `updated_at`/`version` en cada transición y
persistir outbox con su cambio de estado. Las tablas no implementan por sí solas
el publicador o consumidor durable. No guardar firmas, credenciales ni tarjetas.

`db/rollback/V1__drop_payment_storage.sql` documenta el orden inverso de tablas
solo para una base descartable. No se ejecuta por Flyway, no modifica su historial
y no es una estrategia de reversión de datos reales. En un entorno con pagos se
requiere restauración de backup o una migración correctiva aditiva.

## Arranque reproducible

Desde la raíz, `./scripts/setup-dev-environment.sh` prepara `.env` y llaves locales.
Si ya hay un `.env`, se conserva; las variables Payment tienen valores de desarrollo
compatibles en Compose. Revisar `.env.example` para personalizarlas.

```bash
docker compose up --build -d payment-service
docker compose ps payment-db rabbitmq payment-service
curl --fail http://localhost:18085/actuator/health
curl --fail http://localhost:18085/actuator/info
```

PostgreSQL se publica por defecto en `15436` y Payment en `18085`. Internamente
Payment usa `payment-db:5432` y puerto HTTP `8085`. La base tiene usuario y volumen
propios; el servicio espera a PostgreSQL y RabbitMQ saludables. Gateway espera a
Payment y solo enruta el POST exacto del webhook. Para levantar todo, usar
`docker compose up --build -d`; el smoke existente ahora espera también a Payment.

Variables: `PAYMENT_DB_*`, `PAYMENT_SERVICE_PORT`, `INTERNAL_SERVICE_TOKEN`,
`PAYMENT_PROVIDER`, `PAYMENT_REQUEST_TIMEOUT`, `PAYMENT_SIGNATURE_TOLERANCE`,
`MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `PAYMENT_WEBHOOK_PUBLIC_URL`,
`PAYMENT_WEB_RETURN_URL` y `PAYMENT_MOBILE_RETURN_URL`. Las credenciales quedan
vacías y el proveedor deshabilitado en el ejemplo; se inyectarán fuera de Git.
Las URLs de retorno son bases confiables por canal; INT2-111 construirá los
destinos de éxito/pendiente/fallo con la correlación según el contrato.

## Verificación

Desde `backend/`, con Java 21:

```bash
./auth-service/mvnw --batch-mode --no-transfer-progress -pl payment-service,api-gateway -am verify
```

Las pruebas normales migran H2 en modo PostgreSQL y verifican constraints,
idempotencia estructural, preservación de inbox/outbox al volver a migrar,
seguridad real y ausencia de efectos del webhook. Para validar PostgreSQL real:

```bash
SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:15436/cloudcoffee_payment \
SPRING_DATASOURCE_USERNAME=cloudcoffee_payment \
SPRING_DATASOURCE_PASSWORD=payment_local_password \
./auth-service/mvnw --batch-mode --no-transfer-progress -pl payment-service -am verify
```

Usar una base de prueba dedicada: Flyway aplica V1 a su esquema público, y los
tests de constraints crean/eliminan únicamente esquemas temporales propios.
CI incorpora Payment en las matrices PostgreSQL e imagen Docker y conserva los
jobs de servicios existentes. INT2-103 ampliará la integración completa de eventos.
