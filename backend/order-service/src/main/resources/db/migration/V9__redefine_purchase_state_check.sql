ALTER TABLE compras DROP CONSTRAINT chk_compras_estado;
ALTER TABLE compras ADD CONSTRAINT chk_compras_estado CHECK (
    estado = 'REVISION_REQUERIDA'
    OR estado = 'PENDIENTE_PAGO'
    OR estado = 'PAGADO'
    OR estado = 'CANCELADO'
);
