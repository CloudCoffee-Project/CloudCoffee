-- INT2-113: pagos con payment-service (Mercado Pago sandbox). Migración aditiva: los pagos simulados
-- existentes conservan su proveedor, estado y motivo; las columnas nuevas quedan nulas para ellos.

-- Correlación con la intención de Payment y el checkout que se entrega al comprador.
ALTER TABLE pagos ADD COLUMN payment_id UUID;
ALTER TABLE pagos ADD COLUMN preferencia_id VARCHAR(255);
ALTER TABLE pagos ADD COLUMN init_point VARCHAR(2048);
ALTER TABLE pagos ADD COLUMN canal_retorno VARCHAR(16);
-- Solicitud congelada que se envía a Payment: cada reintento manda exactamente la misma carga.
ALTER TABLE pagos ADD COLUMN solicitud_payment TEXT;
-- Última versión de la intención de Payment aplicada: un evento igual o anterior no tiene efecto.
ALTER TABLE pagos ADD COLUMN payment_version BIGINT DEFAULT 0 NOT NULL;
-- Motivo informado por Payment cuando el pago requiere conciliación (aprobacion_tardia, monto_discrepante...).
ALTER TABLE pagos ADD COLUMN motivo_proveedor VARCHAR(64);
-- Última consulta periódica a Payment (conciliación ante eventos perdidos o reinicios).
ALTER TABLE pagos ADD COLUMN consultado_at TIMESTAMP;
CREATE UNIQUE INDEX uk_pagos_payment_id ON pagos (payment_id);

ALTER TABLE pagos ALTER COLUMN estado SET DATA TYPE VARCHAR(32);
ALTER TABLE pagos DROP CONSTRAINT chk_pagos_estado;
ALTER TABLE pagos ADD CONSTRAINT chk_pagos_estado
    CHECK (estado IN ('PENDIENTE', 'APROBADO', 'RECHAZADO', 'REQUIERE_CONCILIACION'));
ALTER TABLE pagos DROP CONSTRAINT chk_pagos_motivo;
ALTER TABLE pagos ADD CONSTRAINT chk_pagos_motivo CHECK (motivo IS NULL OR motivo IN (
    'APROBACION_SIMULADA', 'RECHAZO_SIMULADO', 'ESCENARIO_PENDIENTE',
    'PROCESANDO_STOCK', 'RESERVA_VENCIDA', 'COMPRA_CANCELADA',
    'ESPERANDO_PROVEEDOR', 'PROVEEDOR_CONFIRMADO', 'PROVEEDOR_RECHAZADO', 'PROVEEDOR_CANCELADO',
    'CONCILIACION_REQUERIDA'));
ALTER TABLE pagos ADD CONSTRAINT chk_pagos_canal_retorno
    CHECK (canal_retorno IS NULL OR canal_retorno IN ('web', 'mobile'));
CREATE INDEX idx_pagos_proveedor_estado ON pagos (proveedor, estado);

-- Eventos externos ya aplicados por cada consumidor: se inserta en la misma transacción que la decisión.
CREATE TABLE eventos_consumidos (
    consumidor  VARCHAR(64) NOT NULL,
    event_id    UUID NOT NULL,
    event_type  VARCHAR(128) NOT NULL,
    resultado   VARCHAR(32) NOT NULL,
    created_at  TIMESTAMP NOT NULL,
    CONSTRAINT pk_eventos_consumidos PRIMARY KEY (consumidor, event_id)
);
