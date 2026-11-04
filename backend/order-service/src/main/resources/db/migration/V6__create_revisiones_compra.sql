CREATE TABLE revisiones_compra (
    id UUID PRIMARY KEY,
    compra_id UUID NOT NULL REFERENCES compras(id) ON DELETE RESTRICT,
    usuario_id UUID NOT NULL,
    orden_id UUID,
    accion VARCHAR(10) NOT NULL CHECK (accion IN ('CONFIRMAR', 'CANCELAR')),
    ruta VARCHAR(255) NOT NULL,
    clave UUID NOT NULL,
    plan TEXT NOT NULL,
    fase VARCHAR(12) DEFAULT 'PENDIENTE' NOT NULL CHECK (fase IN ('PENDIENTE', 'TERMINADA')),
    status INTEGER,
    respuesta TEXT,
    trace_id VARCHAR(32) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    CONSTRAINT uk_revision_intencion UNIQUE (usuario_id, ruta, clave),
    CONSTRAINT chk_revision_resultado CHECK (
        (fase='PENDIENTE' AND status IS NULL AND respuesta IS NULL) OR
        (fase='TERMINADA' AND status IS NOT NULL AND status IN (200, 400, 409) AND respuesta IS NOT NULL))
);
CREATE INDEX idx_revision_compra ON revisiones_compra (compra_id, fase);
CREATE INDEX idx_revision_pendiente ON revisiones_compra (fase, updated_at, id);

-- La decisión durable sigue excluyendo otras mutaciones entre los pasos remotos.
ALTER TABLE compras ADD COLUMN revision_pendiente UUID;
ALTER TABLE compras ADD CONSTRAINT fk_compra_revision
    FOREIGN KEY (revision_pendiente) REFERENCES revisiones_compra(id) ON DELETE RESTRICT;
CREATE INDEX idx_compra_revision_pendiente ON compras (revision_pendiente);
