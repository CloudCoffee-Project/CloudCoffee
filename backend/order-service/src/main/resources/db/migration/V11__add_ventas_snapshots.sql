ALTER TABLE ordenes ADD COLUMN campus_id UUID;
ALTER TABLE ordenes ADD COLUMN pagado_at TIMESTAMP;

-- Fechas históricas del pago aprobado. Una orden cancelada no es una venta.
UPDATE ordenes o SET pagado_at = (
    SELECT COALESCE(p.updated_at, p.created_at) FROM pagos p
    WHERE p.compra_id = o.compra_id AND p.estado = 'APROBADO'
)
WHERE o.estado IN ('PAGADO', 'LISTO_PARA_RETIRO', 'ENTREGADO',
    'NO_RETIRADO_PENDIENTE_REVISION', 'NO_RETIRADO_FINAL');

CREATE INDEX idx_ordenes_ventas ON ordenes (cafeteria_id, pagado_at DESC, id DESC);
