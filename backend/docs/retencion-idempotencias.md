# Retención de idempotencias (INT2-119)

Order conserva respuestas de creación, revisión y pago por defecto 30 días desde
`completed_at`. `ORDER_IDEMPOTENCY_RETENTION` acepta duración ISO-8601 y rechaza
menos de 24 horas al arrancar. El lote (`ORDER_IDEMPOTENCY_BATCH_SIZE`, 1–1000,
defecto 100) aplica por tabla y ciclo. `ORDER_IDEMPOTENCY_CLEANUP_INTERVAL` es una
hora por defecto; `ORDER_IDEMPOTENCY_CLEANUP_ENABLED=false` desactiva el job.
Compose transmite las cuatro variables. No se borran compras, ítems, pagos,
inbox/outbox ni datos de Payment/Catalog.

V10 agrega fechas e índices sin alterar migraciones previas. Creación y revisión
registran finalización junto con su respuesta terminal; se migra el histórico
usando `updated_at` solo en fase TERMINADA. Un pago registra finalización cuando
Order resuelve APROBADO/RECHAZADO. Para respuestas históricas sin fecha, el job
observa el estado final por lotes y concede toda la retención desde ese momento.

La selección usa corte estricto (`completed_at < ahora - retención`), orden
estable y `FOR UPDATE SKIP LOCKED` dentro de una transacción corta. Dos workers
no compiten por una fila bloqueada. Los DELETE vuelven a comprobar elegibilidad.
Un replay que cruza el momento de purga recibe `409 IDEMPOTENCY_EXPIRED` si su
registro desapareció entre pasos; las operaciones recientes no son elegibles.

Nunca se purgan NUEVA, RESERVANDO o PENDIENTE ni pagos PENDIENTE o
REQUIERE_CONCILIACION. Se respetan `compras.revision_pendiente`,
`orden_reservas.intento_id` y liberaciones pendientes; la creación tampoco se
purga si su compra continúa en revisión/pago. Los registros referenciados pueden
vivir más que la retención: se conserva la recuperación e historial por encima
de la reducción de tamaño. Las reservas confirmadas que aún conservan su
`intento_id` también mantienen el registro correspondiente.

Tras purga no se garantiza replay: reusar una clave de creación puede crear una
compra nueva. El cliente debe consultar historial y generar una clave nueva para
una intención nueva. Revisión vuelve a validar el estado actual. Pago conserva
la restricción única de un pago por compra: tras limpiar la respuesta, reusar la
clave recibe PAGO_YA_INICIADO y no crea preferencia ni cobro. El identificador
estable y la idempotencia interna de Payment permanecen intactos.

`Idempotency-Key` sigue siendo obligatorio y UUID: OpenAPI ya lo marca required;
los controladores que lo reciben con `required=false` validan manualmente su
ausencia para devolver el error de negocio `IDEMPOTENCY_KEY_INVALIDA` (400).
Gateway ya permite esa cabecera en CORS y expone `Idempotency-Replayed`,
`Location` y `Retry-After`. No se cambia ese contrato ni se añaden rutas públicas
de limpieza. Las suites existentes prueban ausencia, formato, replay y CORS;
las pruebas nuevas cubren corte exacto, finalización tardía, lotes, reinicio,
concurrencia, referencias y ausencia de segundo pago tras purga.
