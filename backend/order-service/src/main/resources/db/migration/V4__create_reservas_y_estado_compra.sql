-- INT2-77: estado de la compra y reservas de stock que el resultado del pago
-- confirma (aprobado), libera (rechazado) o conserva hasta vencer (pendiente).
ALTER TABLE compras ADD COLUMN estado VARCHAR(20) DEFAULT 'PENDIENTE_PAGO' NOT NULL;
ALTER TABLE compras ADD CONSTRAINT chk_compras_estado
    CHECK (estado IN ('PENDIENTE_PAGO', 'PAGADA', 'RECHAZADA', 'EXPIRADA'));
ALTER TABLE compras ADD COLUMN updated_at TIMESTAMP;

-- oferta_id es el UUID de la oferta en catalog-service, guardado por valor.
CREATE TABLE reservas (
    id              UUID PRIMARY KEY,
    compra_id       UUID NOT NULL,
    oferta_id       UUID NOT NULL,
    cantidad        INT NOT NULL,
    estado          VARCHAR(20) NOT NULL,
    vence_en        TIMESTAMP NOT NULL,
    created_at      TIMESTAMP NOT NULL,
    updated_at      TIMESTAMP,

    CONSTRAINT fk_reservas_compra FOREIGN KEY (compra_id) REFERENCES compras (id),
    CONSTRAINT chk_reservas_cantidad CHECK (cantidad > 0),
    CONSTRAINT chk_reservas_estado CHECK (estado IN ('ACTIVA', 'CONFIRMADA', 'LIBERADA')),
    CONSTRAINT uk_reservas_compra_oferta UNIQUE (compra_id, oferta_id)
);

CREATE INDEX idx_reservas_estado_vence_en ON reservas (estado, vence_en);
