-- INT2-119: retención contada desde finalización, nunca desde inicio de la operación.
ALTER TABLE creacion_compras ADD COLUMN completed_at TIMESTAMP;
ALTER TABLE revisiones_compra ADD COLUMN completed_at TIMESTAMP;
ALTER TABLE idempotencia ADD COLUMN completed_at TIMESTAMP;
UPDATE creacion_compras SET completed_at=updated_at WHERE fase='TERMINADA';
UPDATE revisiones_compra SET completed_at=updated_at WHERE fase='TERMINADA';
-- Los pagos históricos se marcan conservadoramente al observar su estado final en el job.
CREATE INDEX idx_creacion_retencion ON creacion_compras (fase, completed_at, id);
CREATE INDEX idx_revision_retencion ON revisiones_compra (fase, completed_at, id);
CREATE INDEX idx_idempotencia_retencion ON idempotencia (completed_at, id);
CREATE INDEX idx_reservas_intento ON orden_reservas (intento_id);
