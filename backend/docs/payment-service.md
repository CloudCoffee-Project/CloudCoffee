# Contrato objetivo de Payment · INT2-108

Versión **2.0.0**, evolución del contrato de pago simulado 1.0.0 de INT2-50.
[Decisión de arquitectura](decisiones/0001-payment-service-sandbox.md) ·
[OpenAPI](payment-service.openapi.json) · [Eventos y ejemplos](payment-service.eventos.json).
Este documento define la integración que implementarán INT2-111/112/113; no afirma
que esos endpoints estén disponibles al incorporar el módulo base de INT2-110.

## Límites e identidad

Payment conserva intenciones, preferencias, pagos del proveedor, inbox y outbox en
su propia base. `compraId` y `clienteId` son referencias externas sin FK a Order o
Auth. Order conserva snapshots, reservas, autorización y estado de cumplimiento.
No se admiten datos de tarjeta ni reparto real de fondos entre cafeterías.

| API | Autenticación y acceso |
| --- | --- |
| `POST /v1/compras/{compraId}/pago` | JWT CLIENTE propietario; implementada por Order. |
| `GET /v1/compras/{compraId}/pago` | JWT CLIENTE propietario; lectura de Order, 404 para ajeno. |
| `POST /internal/servicios/payments/preferencias` | Solo token interno, llamada directa de Order a Payment. |
| `GET /internal/servicios/payments/preferencias/{compraId}` | Solo token interno; no inicia pagos. |
| `POST /v1/payments/webhooks/mercadopago` | Única ruta pública Payment en Gateway; firma del proveedor. |

Gateway elimina únicamente `/v1` del webhook. No publica `/internal/**` ni un proxy
`/v1/payments/**`. Reutilizar `X-Internal-Service-Token` y `common-security`;
JWT de usuario, incluso SUPER_ADMIN, no da acceso interno. La firma se implementa
en INT2-112: hasta entonces el webhook falla cerrado (503), sin procesar ni acusar
recibos como si fueran válidos. No registrar tokens ni firmas en logs.

## Inicio, importes y retorno

1. Order resuelve todas las órdenes en revisión y obtiene reservas vigentes para
   las órdenes activas. Si falta revisión: 409 `REVISION_REQUERIDA`; si vencieron
   reservas: 409 `RESERVA_VENCIDA`. No abrir checkout sobre cotizaciones parciales.
2. El cliente envía `{ "canalRetorno": "web" }` o `"mobile"`, con
   `Idempotency-Key` UUID. No envía monto, propietario, URL, estado ni escenario.
3. Order congela ítems y total entero CLP (1 a 2.000.000.000), crea/persiste la
   intención antes de llamar a Payment y transmite `compraId`, `clienteId`, ítems,
   `montoTotal`, `moneda`, `expiraAt` y canal. La suma de ítems debe coincidir.
4. Payment crea una sola preferencia Checkout Pro por compra/intención y guarda
   su ID, referencia externa estable y URL de checkout del entorno de prueba.
   La elección de `init_point`/`sandbox_init_point` se verifica con las credenciales
   y modalidad de prueba configuradas en INT2-111; no se deduce del hostname.
5. `201 Pago` devuelve estado `pendiente`, `simulado:false`, proveedor
   `mercadopago_sandbox`, `entorno:sandbox`, `paymentId`, `preferenciaId`,
   `initPoint` y `expiraAt`, además de los campos comunes de Pago de INT2-50.
   `paymentId` identifica la intención local de Payment; `pagoId` la proyección Order.
6. URLs de éxito, pendiente y fallo salen de configuración por canal, nunca de
   parámetros del comprador. Usar HTTPS público en el sandbox integrado. El
   retorno solo abre el cliente; este consulta a Order. Un retorno «approved» no
   confirma pago, stock ni QR. GET no crea preferencias ni hace una nueva compra.

`expiraAt` es el mínimo vencimiento de las reservas activas (actualmente como
máximo creación + 15 minutos). Configurar la expiración de la preferencia cuando
el proveedor lo permita, sin asumir que impide todo pago tardío. No extender
reservas silenciosamente. Una compra multi cafetería paga la suma de órdenes
activas en una sola preferencia; los ítems incluyen su `ordenId` para correlación.

## Idempotencia y errores

Order conserva su clave pública por propietario/operación y Payment conserva la
clave interna por operación, hash canónico del request e intención única por compra.
Misma clave/carga devuelve el resultado ya persistido y `Idempotency-Replayed:true`;
misma clave con otra carga: 409 `IDEMPOTENCIA_CONFLICTO`. Otra clave para la misma
compra devuelve su intención existente si la carga coincide y, si no, 409
`PAGO_YA_INICIADO`. No reemplazar una preferencia que podría haber sido pagada.

Si el POST al proveedor queda ambiguo, persistir `REQUIRES_RECONCILIATION`, responder
503 `PAGO_EN_CONCILIACION` y `Retry-After:2`. Consultar por referencia estable y
resolver la incertidumbre antes de reintentar creación. No asumir que Checkout
Preferences soporta las garantías de idempotencia de otras APIs de Mercado Pago.
Si no se puede demostrar que no existe una preferencia, mantener conciliación y
exigir resolución operativa; no cobrar otra vez. Retener correlaciones e historial
mientras exista una posible confirmación externa, incluso tras limpiar claves.

Errores usan Problem Details común con `codigo`, `timestamp` e `instance`:
400 validación; 401 sin credencial; 403 rol/credencial insuficiente; 404 recurso
ajeno/inexistente; 409 revisión, vencimiento o conflicto; 503 dependencia no
disponible/resultado ambiguo. Respuestas privadas: `Cache-Control:no-store`.

## Estados y conciliación

Payment guarda el estado crudo y fecha de actualización del proveedor por ID de
pago externo, además de su estado normalizado. Pueden existir varios pagos externos
asociados a la misma preferencia: no deduplicar usando solo preferencia o pago ID.

| Resultado consultado al proveedor | Payment / efecto en Order |
| --- | --- |
| `pending`, `in_process`, `authorized`, `in_mediation` | `pendiente`; no habilita QR. Mediación requiere revisión operativa. |
| `approved` válido y en plazo | Payment `aprobado`; Order confirma todas las reservas mediante INT2-77 y solo después publica su aprobación y estado pagado. |
| `rejected` | `rechazado`; cancelar compra y liberar una vez según contrato. No ofrecer otra preferencia para la misma compra. |
| `cancelled` | `cancelado`; compensar una vez. |
| Vencimiento local sin aprobación aplicada | `vencido`; Order libera reservas y bloquea retiro. Seguir conciliando confirmaciones tardías. |
| `approved` tardío, monto/moneda/referencia/entorno discrepantes, `refunded` o `charged_back` | `requiere_conciliacion`; preservar evidencia, bloquear nuevo cumplimiento y no reintegrar stock automáticamente. |

La fecha efectiva del proveedor y el límite persistido determinan tardanza; el orden
de llegada del webhook no basta. Si una aprobación en plazo llega tarde y las
reservas ya se liberaron, también requiere conciliación. No recrear reservas ni
reembolsar automáticamente. La resolución manual queda auditada; cualquier devolución
real está fuera del alcance sandbox. Dos pagos aprobados de la misma preferencia
generan una anomalía conciliable, nunca dos cumplimientos. No retroceder un estado
por una notificación antigua; consultar el recurso actual y controlar versión local.
Order conserva un resultado externo aprobado aun si su proyección sigue
`pendiente`/`procesando_stock` hasta que Catalog confirme todas las reservas.

## Webhook, inbox y eventos

Validar `x-signature`, `x-request-id` y el identificador canónico indicado por la
documentación oficial. Verificar HMAC en tiempo constante, timestamp y tolerancia
configurada (por defecto 5 minutos), rechazando datos incompletos o discrepantes.
Consultar `GET /v1/payments/{id}` de Mercado Pago con credencial backend; comprobar
referencia, total, CLP y entorno de prueba contra la intención persistida.
Una firma válida por sí sola no acredita una compra.

Responder 202 solo después de persistir una notificación autenticada en inbox;
duplicado ya persistido responde 200. Firma inválida: 401; contrato inválido: 400;
fallo durable/transitorio: 503. Si no hay secreto/verificador activo: 503. Guardar
solo metadatos necesarios y payload saneado, nunca firma, bearer o datos de tarjeta.
Deduplicar `(proveedor, notificationId)` y aplicar cambios por versión de agregado;
una actualización distinta del mismo pago externo se procesa normalmente.

En la misma transacción del cambio, escribir outbox con evento estable:
`payment.pago.resultado.v1`, exchange durable `cloudcoffee.events`, routing key igual
al tipo. Envelope: `eventId`, `eventType`, `timestamp` UTC, `traceId`, `payload`.
Payload contiene intención/compra/cliente, preferencia y pago externo, resultado,
motivo, CLP, entorno, versión, fecha efectiva y expiración; schema y ejemplos en JSON.
No reutilizar `order.pago.resultado.v1` para la confirmación del proveedor: ese
evento conserva la proyección de Order y su garantía de stock confirmado.

Publicar con confirmación/mandatory; reintentar el mismo `eventId`, no generar uno
nuevo. Consumidor Order deduplica `(consumidor,eventId)` en la transacción de su
decisión; sus efectos remotos usan la recuperación durable existente. Tras agotar
reintentos conservar evidencia y enviar a DLQ según topología compartida. Consultar
periódicamente pagos pendientes/ambiguos y aprobaciones tardías; un broker o correo
caído no pierde ni revierte el hecho de pago.

## Configuración y transición

* `PAYMENT_SERVICE_URL`, base/usuario/password propios y token interno común.
* `PAYMENT_PROVIDER=disabled` para el módulo base; `mercadopago_sandbox` solo al
  implementar y validar INT2-111/112. Credencial `MERCADOPAGO_ACCESS_TOKEN`, secreto
  `MERCADOPAGO_WEBHOOK_SECRET`, URL HTTPS `PAYMENT_WEBHOOK_PUBLIC_URL`, URLs de retorno
  web/móvil, timeouts y tolerancia de firma configurables. Nunca en frontend/Git.
* Order mantiene el simulador actual hasta INT2-113. Esa issue incorporará selección
  explícita `ORDER_PAYMENT_PROVIDER=simulado|mercadopago_sandbox`; el modo sandbox
  rechaza `escenario` y no cambia de proveedor ante fallos.
* Mantener pagos simulados históricos con su proveedor; no convertirlos ni
  acreditarlos como externos. Completar/conciliar operaciones abiertas antes del
  cambio. Migraciones aditivas, sin editar las ya aplicadas.
* Backend y clientes despliegan juntos el comando nuevo. El OpenAPI 1.0.0 queda como
  contrato histórico del simulador y el 2.0.0 como objetivo de esta integración.

## Evidencia de aceptación

Compra de 2 cafeterías por 3.600 + 1.200 CLP: una preferencia de 4.800 CLP,
un resultado externo y una confirmación por reserva. Probar aprobación, rechazo,
pendiente, cancelación, vencimiento, pago tardío, retorno alterado, firma inválida,
referencia/monto/entorno ajenos, doble aprobación y notificaciones fuera de orden.
Repetir inicio/webhook/consumo con caída del proveedor, broker y reinicio; no duplicar
preferencia ni stock. CI usa proveedor controlado; la evidencia de preferencia y
checkout sandbox se registra aparte. La documentación del proveedor advierte que
ciertas modalidades con credenciales de prueba no envían notificaciones: comprobar
el modo elegido y usar su simulador de notificaciones más conciliación, sin
presentarlo como prueba de un webhook recibido espontáneamente.

## Referencias oficiales (consultadas el 13-11-2026)

Validar OpenAPI, JSON Schema y ejemplos desde la raíz, en un entorno temporal con
`openapi-spec-validator` y `jsonschema`: `python scripts/validate-payment-contract.py`.

* [Crear preferencia](https://www.mercadopago.cl/developers/en/reference/online-payments/checkout-pro-preferences/create-preference/post).
* [Consultar preferencia](https://www.mercadopago.cl/developers/en/reference/online-payments/checkout-pro-preferences/get-preference/get).
* [Notificaciones de pago y validación de origen](https://www.mercadopago.cl/developers/en/docs/checkout-pro-preferences/payment-notifications).
