-- INT2-77: aplicar el resultado del pago sobre compra, órdenes y reservas.

-- Traza de la operación original: un reintento conserva el mismo traceId en sus eventos.
ALTER TABLE pagos ADD COLUMN trace_id VARCHAR(32);
CREATE INDEX idx_pagos_estado_motivo ON pagos (estado, motivo);

-- Reservas de un pago rechazado que Catalog aún no confirma como liberadas. Se escriben
-- en la transacción del rechazo y se reintentan hasta tener respuesta.
CREATE TABLE liberaciones_reserva (
    reserva_id UUID PRIMARY KEY,
    compra_id UUID NOT NULL REFERENCES compras(id) ON DELETE RESTRICT,
    created_at TIMESTAMP NOT NULL
);
CREATE INDEX idx_liberaciones_compra ON liberaciones_reserva (compra_id);
