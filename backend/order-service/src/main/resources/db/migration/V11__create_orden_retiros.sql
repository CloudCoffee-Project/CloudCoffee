CREATE TABLE orden_retiros (
    orden_id UUID PRIMARY KEY REFERENCES ordenes(id) ON DELETE RESTRICT,
    codigo_hash VARCHAR(64) NOT NULL UNIQUE,
    codigo_cifrado VARCHAR(128) NOT NULL,
    preparado_por UUID NOT NULL,
    preparado_at TIMESTAMP NOT NULL,
    CONSTRAINT chk_retiro_hash CHECK (LENGTH(codigo_hash) = 64)
);
