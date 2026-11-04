-- La tabla corresponde exclusivamente a (POST, /compras); otras rutas mantienen su espacio propio.
CREATE TABLE creacion_compras (
    id UUID PRIMARY KEY,
    usuario_id UUID NOT NULL,
    clave UUID NOT NULL,
    hash_cuerpo VARCHAR(64) NOT NULL,
    solicitud TEXT NOT NULL,
    plan TEXT,
    fase VARCHAR(16) DEFAULT 'NUEVA' NOT NULL,
    respuesta TEXT,
    status INTEGER,
    location VARCHAR(255),
    trace_id VARCHAR(32) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    CONSTRAINT uk_creacion_usuario_clave UNIQUE (usuario_id, clave),
    CONSTRAINT chk_creacion_fase CHECK (fase IN ('NUEVA', 'RESERVANDO', 'TERMINADA')),
    CONSTRAINT chk_creacion_resultado CHECK ((fase = 'TERMINADA' AND respuesta IS NOT NULL AND status IS NOT NULL
        AND status IN (201, 400, 409)) OR (fase <> 'TERMINADA' AND respuesta IS NULL AND status IS NULL))
);
CREATE INDEX idx_creacion_pendiente ON creacion_compras (fase, updated_at, id);

-- IDs de reservas activas que consumirán las siguientes transiciones de Order (INT2-73/77).
CREATE TABLE orden_reservas (
    orden_id UUID NOT NULL REFERENCES ordenes(id) ON DELETE RESTRICT,
    oferta_id UUID NOT NULL,
    reserva_id UUID NOT NULL UNIQUE,
    intento_id UUID NOT NULL,
    PRIMARY KEY (orden_id, oferta_id)
);

-- Eventos de creación escritos en la misma transacción que compra/órdenes y respuesta idempotente.
CREATE TABLE order_outbox (
    event_id UUID PRIMARY KEY,
    event_type VARCHAR(80) NOT NULL,
    cuerpo TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    publicado BOOLEAN DEFAULT FALSE NOT NULL
);
CREATE INDEX idx_order_outbox_pendiente ON order_outbox (publicado, created_at, event_id);
