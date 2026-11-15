# Payment Service · INT2-110 / INT2-111 / INT2-112

Módulo Spring Boot 4.0.8 / Java 21 del reactor backend, con `common-security`,
`common-errors`, Flyway, PostgreSQL, RabbitMQ, Actuator y Zipkin.

## Estado y límites de la entrega

INT2-110 entregó estructura, persistencia y ejecución integrada; INT2-111 agrega la
creación y consulta de preferencias Checkout Pro sandbox; INT2-112 agrega el webhook
firmado, la conciliación de pagos con el proveedor y la publicación durable de
`payment.pago.resultado.v1`. El contrato objetivo está en
[Payment INT2-108](../docs/payment-service.md). El consumo del evento por Order sigue en
INT2-113: Order todavía usa su simulador y nadie llama a esta API hasta entonces.

`PAYMENT_PROVIDER=disabled` (por defecto) mantiene el servicio cerrado: la API interna
responde **503 PAYMENT_NOT_ENABLED** sin persistir nada. `mercadopago_sandbox` habilita
el adaptador y exige al arrancar credencial, modalidad de checkout coherente y URLs de
retorno HTTPS; con configuración incompleta el servicio no arranca.

El único endpoint de negocio expuesto por Gateway es
`POST /v1/payments/webhooks/mercadopago` (Payment recibe `POST /payments/webhooks/mercadopago`).
Sin `mercadopago_sandbox` o sin `MERCADOPAGO_WEBHOOK_SECRET` responde **503
PAYMENT_NOT_ENABLED** con `Retry-After: 2`, sin aceptar ni persistir notificaciones.
No confundir salud del módulo con integración de pago lista.

Las rutas `/internal/servicios/**` usan `X-Internal-Service-Token` (mínimo 32
caracteres) mediante el filtro compartido; un JWT, incluso SUPER_ADMIN, no las autoriza
(403). Gateway no las publica. Payment solo recibe la llave JWT pública de Auth.

## Preferencias sandbox (INT2-111)

| Método | Ruta interna | Resultado |
| --- | --- | --- |
| `POST` | `/internal/servicios/payments/preferencias` | `201 Preferencia` con `Idempotency-Replayed`; requiere `Idempotency-Key` UUID. |
| `GET` | `/internal/servicios/payments/preferencias/{compraId}` | `200 Preferencia` persistida; `404 PAGO_NO_ENCONTRADO`. Nunca llama al proveedor. |

Cuerpo del POST (contrato `CrearPreferencia`): `compraId`, `clienteId`, `montoTotal`,
`moneda: "CLP"`, `items[]` (`ordenId`, `ofertaId`, `titulo`, `cantidad`,
`precioUnitario`), `canalRetorno: "web" | "mobile"` y `expiraAt`. Todo lo envía Order.

* **Importes solo desde Order:** validación estricta del JSON. Enteros CLP (un `4800.5`
  o `"4800"` es 400, no se trunca), la suma de ítems debe igualar `montoTotal` y se
  rechaza cualquier campo extra (por ejemplo una URL o un estado): `400 SOLICITUD_INVALIDA`.
* **Retorno fijo por canal:** `PAYMENT_WEB_RETURN_URL` o `PAYMENT_MOBILE_RETURN_URL` más
  `?compraId=…&resultado=exito|pendiente|fallo`. El retorno solo reabre el cliente: no
  confirma pago, stock ni QR.
* **Una preferencia por compra:** referencia externa estable = `paymentId` (ID de la
  intención). Misma clave y carga devuelve lo persistido; misma clave con otra carga es
  `409 IDEMPOTENCIA_CONFLICTO`; otra clave para la compra con la misma carga devuelve la
  intención existente y con otra carga `409 PAGO_YA_INICIADO`. Compra vencida antes de
  abrir el checkout: `409 RESERVA_VENCIDA`.
* **Checkout del entorno:** `PAYMENT_CHECKOUT_MODE=test-user` (token `APP_USR-` de una
  cuenta vendedora de prueba) entrega `init_point`; `test-credentials` (token `TEST-`)
  entrega `sandbox_init_point`. Se valida al arrancar y nunca se deduce del hostname.
  Solo se guarda una URL HTTPS devuelta por el proveedor.
* **Expiración:** la preferencia se crea con `expires`, `expiration_date_to` y
  `date_of_expiration` = `expiraAt`; no reemplaza la conciliación de pagos tardíos.

### Timeout, reintento y respuesta perdida

No se asume que Mercado Pago deduplica la creación de preferencias (se envía
`X-Idempotency-Key` igual, solo como defensa adicional). Estados sin preferencia:

| Estado interno | Significado | Siguiente solicitud |
| --- | --- | --- |
| `CREATING` | Nunca se envió un POST, o el proveedor lo rechazó de forma definitiva (4xx, conexión no establecida). | Crea. |
| `REQUIRES_RECONCILIATION` | Hay o pudo haber un POST sin resultado confirmado (timeout, 5xx, 429, respuesta inválida o caída del proceso). | Busca por `external_reference`; si la encuentra la guarda; si sigue vacía, solo recrea pasado `PAYMENT_RECONCILIATION_SETTLE_TIME` (1 min) y antes de `expiraAt`. |

Antes de cada POST la intención pasa a `REQUIRES_RECONCILIATION` con un `UPDATE`
condicionado por versión: entre solicitudes concurrentes solo una llama al proveedor y
una caída a mitad de la llamada nunca deja un estado que permita crear a ciegas.
Respuestas: `503 PAGO_EN_CONCILIACION` y `503 PROVEEDOR_NO_DISPONIBLE`, ambas con
`Retry-After: 2`; Order debe reintentar con la misma `Idempotency-Key`. Si la búsqueda
encuentra más de una preferencia o falla, se mantiene la conciliación y se registra para
revisión operativa. El GET informa `requiere_conciliacion` con `preferenciaId` e
`initPoint` nulos mientras no haya preferencia confirmada.

### Evidencia con una preferencia sandbox real

CI usa adaptadores controlados (`MercadoPagoPreferenciasTests`, servidor HTTP simulado,
y `PreferenciasInternasIntegrationTests`, proveedor con estado). La evidencia real se
genera aparte con credenciales de prueba, nunca commiteadas. Desde `backend/`:

```bash
MERCADOPAGO_EVIDENCE=true MERCADOPAGO_ACCESS_TOKEN=APP_USR-... PAYMENT_CHECKOUT_MODE=test-user \
./auth-service/mvnw --batch-mode --no-transfer-progress -pl payment-service test -Dtest=MercadoPagoSandboxEvidenceTests
```

Crea una preferencia de 4.800 CLP (2 × 1.800 + 1 × 1.200), comprueba que la búsqueda por
`external_reference` la encuentra y escribe `payment-service/target/mercadopago-sandbox-evidence.json`
(ID, referencia, URL de checkout y segundos que tardó la búsqueda, sin credenciales).
Abrir la URL con un comprador de prueba completa la evidencia del checkout. Con el
servicio levantado en modo `mercadopago_sandbox` también puede probarse la API real:

```bash
curl -i -X POST http://localhost:18085/internal/servicios/payments/preferencias \
  -H "X-Internal-Service-Token: $INTERNAL_SERVICE_TOKEN" -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" -d @preferencia.json
curl -i http://localhost:18085/internal/servicios/payments/preferencias/<compraId> \
  -H "X-Internal-Service-Token: $INTERNAL_SERVICE_TOKEN"
```

## Webhook, conciliación y eventos (INT2-112)

### Recepción: `POST /payments/webhooks/mercadopago`

Público solo para este POST exacto y sin JWT: se autentica con la firma del proveedor.

| Caso | Resultado |
| --- | --- |
| Proveedor deshabilitado o sin secreto | `503 PAYMENT_NOT_ENABLED`, `Retry-After: 2`. |
| `data.id` o `type` de la URL ausentes, o `type` distinto de `payment` | `400 NOTIFICACION_INVALIDA`. |
| `x-signature`/`x-request-id` ausentes, HMAC distinto o timestamp fuera de `PAYMENT_SIGNATURE_TOLERANCE` (5 min, en ambos sentidos) | `401 FIRMA_INVALIDA`. No se guarda nada. |
| Cuerpo no JSON, sin `id`, con otro `type` o con `data.id` distinto del de la URL firmada (máx. 16 KB) | `400 NOTIFICACION_INVALIDA`. |
| Notificación nueva | Se guarda en `payment_inbox` y responde **202**. |
| Mismo `id` de notificación ya guardado (reintento del proveedor) | **200**, sin repetir efectos. |
| Base de datos no disponible | `503 RECEPCION_NO_DISPONIBLE`; el proveedor reintenta. |

Firma según la documentación de Webhooks de Mercado Pago: `x-signature: ts=<ts>,v1=<hmac>`,
HMAC-SHA256 hexadecimal con la clave secreta sobre el manifiesto
`id:<data.id>;request-id:<x-request-id>;ts:<ts>;` (`data.id` de la URL, en minúsculas). Se
exigen las tres partes, se compara en tiempo constante y se acepta `ts` en segundos o en
milisegundos. El inbox guarda solo metadatos saneados (id de notificación, acción, `data.id`,
`live_mode`, fechas y `x-request-id`): nunca la firma, tokens ni datos del pagador.
**La firma solo prueba el origen; no acredita ningún pago.**

### Procesamiento y estados

Tareas programadas (`PAYMENT_POLL_INTERVAL`, 5 s; se apagan con `PAYMENT_PROCESSING_ENABLED=false`)
que solo trabajan con `mercadopago_sandbox`. Cada fila se reclama con un `UPDATE` condicionado
y una reserva (`lease`, 1 min) antes de trabajar en ella: varias instancias o un reinicio a
mitad de camino nunca procesan dos veces la misma fila, y una reserva abandonada se retoma.

1. **Inbox:** por cada notificación se consulta `GET /v1/payments/{id}` con la credencial del
   backend. Proveedor caído, pago aún no visible (404) o intención sin preferencia confirmada
   reprograman con backoff exponencial (10 s hasta 15 min). Tras `PAYMENT_MAX_ATTEMPTS` (12) la
   entrada queda `DEAD` con su último error, como evidencia.
2. **Validación contra la intención:** el pago se asocia por `external_reference`. Monto exacto
   en CLP, moneda `CLP` y `live_mode=false` deben coincidir. Una discrepancia se guarda en
   `payment_anomaly` (evidencia saneada) y, si el pago está aprobado o en curso, la intención
   pasa a `REQUIRES_RECONCILIATION`. Un pago con referencia ajena solo deja evidencia.
3. **Transición**, en una transacción con la fila de la intención bloqueada, junto con el outbox:

| Pago consultado | Intención `PENDING` | Intención ya cerrada |
| --- | --- | --- |
| `pending`, `in_process`, `authorized` | Sin cambio ni evento. | Sin cambio. |
| `approved` con fecha de aprobación ≤ `expiraAt` | `APPROVED` (`proveedor_confirmado`). | `EXPIRED`: conciliación (`aprobacion_tras_vencimiento`); `REJECTED`/`CANCELLED`: `aprobacion_tras_cierre`; otro pago aprobado sobre `APPROVED`: `doble_aprobacion`. |
| `approved` con fecha > `expiraAt` | Conciliación (`aprobacion_tardia`). | Igual. |
| `rejected` / `cancelled` | `REJECTED` / `CANCELLED`. | Sin cambio (nunca deshace una aprobación). |
| `in_mediation`, `refunded`, `charged_back` | Conciliación (`en_mediacion`, `reembolsado`, `contracargo`). | Igual. |

Los estados no retroceden: solo `PENDING` pasa a un resultado, y desde un resultado solo se
llega a `REQUIRES_RECONCILIATION`, que es final para la automatización (resolución manual).
Una observación más vieja que la guardada para el mismo pago externo se descarta, y la tardanza
se decide con la fecha de aprobación del proveedor, no con el orden de llegada.

4. **Conciliación periódica:** cada intención abierta se consulta por referencia externa
   (`/v1/payments/search`) cada `PAYMENT_RECONCILIATION_INTERVAL` (2 min), aunque se pierdan
   notificaciones. Pasado `expiraAt` sin aprobación aplicada vence (`EXPIRED`, `reserva_vencida`);
   si el proveedor no responde se espera `PAYMENT_EXPIRY_GRACE` (5 min) antes de vencer. Las
   intenciones cerradas se siguen consultando durante `PAYMENT_LATE_APPROVAL_WINDOW` (3 días)
   para detectar aprobaciones tardías, dobles aprobaciones o reembolsos.

### Evento `payment.pago.resultado.v1`

Cada cambio de estado escribe en `payment_outbox`, en la misma transacción, un evento con el
envelope y el payload del [contrato](../docs/payment-service.eventos.json): `eventId` estable,
`traceId` de la notificación, `version` = versión de la intención y `ocurridoAt` = fecha efectiva
del proveedor (la de aprobación si fue aprobado; `expiraAt` si venció). El publicador envía a
`cloudcoffee.events` (routing key = tipo) con publisher confirms y `mandatory`:

* Confirmado y enrutado: `PUBLISHED`. Broker caído, sin confirmación, rechazo o sin ruta:
  reintento con backoff y **el mismo eventId** (Order deduplica por `eventId`).
* Por intención se publica en orden de versión: una versión no sale antes que una anterior pendiente.
* Agotados los intentos, el evento se copia a `payment.events.dlq` (exchange `cloudcoffee.dlx`,
  cabecera `x-cloudcoffee-error`) y la fila queda `DEAD`. Si la DLQ tampoco confirma, el evento
  sigue `PENDING`: un broker caído nunca pierde ni revierte un hecho de pago.

Hasta INT2-113 nadie enlaza una cola a `payment.pago.resultado.v1`, así que los eventos
devueltos por falta de ruta terminan en la DLQ tras sus reintentos. Se pueden reencolar desde
ella o volviendo a poner la fila en `PENDING`.

### Probar notificaciones en sandbox

En la aplicación de Mercado Pago (Tus integraciones, Webhooks) configurar la URL pública HTTPS
del Gateway con el evento *Pagos*, copiar la clave secreta a `MERCADOPAGO_WEBHOOK_SECRET` y usar
la misma URL en `PAYMENT_WEBHOOK_PUBLIC_URL` (se envía como `notification_url` en cada preferencia).
La documentación del proveedor advierte que algunas modalidades con credenciales de prueba no
envían notificaciones; en ese caso, usar el simulador de notificaciones del panel. El simulador
envía un `data.id` ficticio: la firma se valida (202), pero la consulta del pago dará 404 y la
entrada terminará `DEAD`. El resultado real del pago llega igual por la conciliación periódica.
No presentar una notificación simulada como evidencia de un webhook recibido espontáneamente.

## Persistencia

V1 crea cinco tablas, sin semillas y sin referencias a bases ajenas:

| Tabla | Invariantes y uso previsto |
| --- | --- |
| `payment_intent` | Una compra y clave de idempotencia únicas, hash/payload de intención, CLP, entorno sandbox, expiración y versión. |
| `payment_preference` | Una preferencia por intención; identificador externo único y checkout persistido. |
| `provider_payment` | Múltiples pagos externos auditables por preferencia/intención; ID externo único. |
| `payment_inbox` | Deduplicación por proveedor/notificación, payload saneado y recuperación de pendientes. |
| `payment_outbox` | Event ID estable y unicidad por intención/versión/tipo, publicación y reintento pendientes. |

INT2-111 usa `payment_intent` y `payment_preference` sin migraciones nuevas. INT2-112 agrega
V2 (aditiva): `payment_intent.status_reason` (motivo del último cambio),
`payment_intent.provider_checked_at` (última consulta periódica) y la tabla `payment_anomaly`
(evidencia de discrepancias, única por pago externo y motivo, con intención opcional para
referencias ajenas).
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
`PAYMENT_WEB_RETURN_URL`, `PAYMENT_MOBILE_RETURN_URL`, `PAYMENT_CHECKOUT_MODE`,
`PAYMENT_RECONCILIATION_SETTLE_TIME` y, para INT2-112, `PAYMENT_RECONCILIATION_INTERVAL`,
`PAYMENT_EXPIRY_GRACE`, `PAYMENT_LATE_APPROVAL_WINDOW` y `PAYMENT_MAX_ATTEMPTS` (más
`PAYMENT_PROCESSING_ENABLED`, `PAYMENT_POLL_INTERVAL`, `PAYMENT_RETRY_BACKOFF`,
`PAYMENT_MAX_BACKOFF` y `PAYMENT_PROCESSING_LEASE`, con valores por defecto en
`application.yml`). Las credenciales quedan vacías y el proveedor
deshabilitado en el ejemplo; se inyectan fuera de Git. Las URLs de retorno son bases
HTTPS confiables por canal, sin query ni fragmento; Payment agrega la correlación.

## Verificación

Desde `backend/`, con Java 21:

```bash
./auth-service/mvnw --batch-mode --no-transfer-progress -pl payment-service,api-gateway -am verify
```

Las pruebas normales migran H2 en modo PostgreSQL y verifican constraints,
idempotencia estructural, preservación de inbox/outbox al volver a migrar,
seguridad real, el webhook cerrado sin proveedor y el flujo de preferencias con un
proveedor controlado (idempotencia, concurrencia, timeout y respuesta perdida).

INT2-112 agrega `FirmaWebhookTests` (manifiesto, HMAC, tolerancia, cabeceras mal formadas),
`MercadoPagoPagosTests` (servidor HTTP simulado: campos saneados, 404 frente a caída, búsqueda
incompleta) y `PagosIntegrationTests`, de punta a punta con proveedor, broker y reloj
controlados: firma inválida, notificación repetida, referencia ajena, monto/moneda/entorno
discrepantes, rechazo, cancelación, notificaciones fuera de orden, aprobación tardía y tras
vencimiento, doble aprobación, reembolso, caída del proveedor con backoff y `DEAD`, trabajadores
concurrentes y reinicio, notificaciones perdidas, vencimiento con proveedor caído, outbox con
broker caído, DLQ y orden por versión. El evento se valida contra
`docs/payment-service.eventos.json`. `RabbitCanalEventosIntegrationTests` usa un RabbitMQ real
(solo con `RABBIT_INTEGRATION_TEST=true`, como en el job de CI). Para validar PostgreSQL real:

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
