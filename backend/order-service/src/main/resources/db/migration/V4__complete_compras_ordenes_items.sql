-- INT2-52: ampliar la base mínima de INT2-53 sin modificar migraciones aplicadas.
-- Se conserva escala 2 por compatibilidad con pagos; los CHECK exigen CLP enteros
-- sin redondear datos históricos. Una base con fracciones debe corregirse antes
-- de migrar: la migración falla, en vez de cambiar importes silenciosamente.
ALTER TABLE compras ALTER COLUMN monto_total TYPE NUMERIC(12, 2);
ALTER TABLE pagos ALTER COLUMN monto TYPE NUMERIC(12, 2);
ALTER TABLE compras DROP CONSTRAINT chk_compras_monto_total;
ALTER TABLE compras ADD CONSTRAINT chk_compras_monto_total
    CHECK (monto_total BETWEEN 0 AND 2000000000 AND monto_total = FLOOR(monto_total));
ALTER TABLE pagos ADD CONSTRAINT chk_pagos_monto_clp
    CHECK (monto <= 2000000000 AND monto = FLOOR(monto));

ALTER TABLE compras ADD COLUMN estado VARCHAR(32) DEFAULT 'PENDIENTE_PAGO' NOT NULL;
ALTER TABLE compras ADD COLUMN moneda VARCHAR(3) DEFAULT 'CLP' NOT NULL;
ALTER TABLE compras ADD COLUMN reserva_expira_at TIMESTAMP;
ALTER TABLE compras ADD COLUMN updated_at TIMESTAMP;
ALTER TABLE compras ADD COLUMN version BIGINT DEFAULT 0 NOT NULL;

-- Los pagos históricos son la única evidencia de estado disponible. No inventar
-- cafeterías ni ítems para las compras anteriores, que nunca guardaron snapshots.
UPDATE compras SET reserva_expira_at = created_at + INTERVAL '15' MINUTE,
    updated_at = created_at;
UPDATE compras SET estado = 'PAGADO'
    WHERE id IN (SELECT compra_id FROM pagos WHERE estado = 'APROBADO');
UPDATE compras SET estado = 'CANCELADO', monto_total = 0
    WHERE id IN (SELECT compra_id FROM pagos WHERE estado = 'RECHAZADO');
ALTER TABLE compras ALTER COLUMN reserva_expira_at SET NOT NULL;
ALTER TABLE compras ALTER COLUMN reserva_expira_at SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '15' MINUTE);
ALTER TABLE compras ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE compras ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE compras ADD CONSTRAINT chk_compras_estado
    CHECK (estado IN ('REVISION_REQUERIDA', 'PENDIENTE_PAGO', 'PAGADO', 'CANCELADO'));
ALTER TABLE compras ADD CONSTRAINT chk_compras_moneda CHECK (moneda = 'CLP');
ALTER TABLE compras ADD CONSTRAINT chk_compras_version CHECK (version >= 0);
ALTER TABLE compras ADD CONSTRAINT chk_compras_cancelada CHECK (estado <> 'CANCELADO' OR monto_total = 0);
CREATE INDEX idx_compras_historial ON compras (usuario_id, created_at DESC, id DESC);

CREATE TABLE ordenes (
    id UUID PRIMARY KEY,
    compra_id UUID NOT NULL,
    codigo_orden VARCHAR(64) NOT NULL,
    cafeteria_id UUID NOT NULL,
    cafeteria_nombre VARCHAR(255) NOT NULL,
    estado VARCHAR(32) NOT NULL,
    monto_total NUMERIC(12, 2) NOT NULL,
    moneda VARCHAR(3) DEFAULT 'CLP' NOT NULL,
    reserva_expira_at TIMESTAMP NOT NULL,
    retiro_hasta TIMESTAMP,
    entregado_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    version BIGINT DEFAULT 0 NOT NULL,
    CONSTRAINT fk_ordenes_compra FOREIGN KEY (compra_id) REFERENCES compras(id) ON DELETE RESTRICT,
    CONSTRAINT uk_ordenes_compra_cafeteria UNIQUE (compra_id, cafeteria_id),
    CONSTRAINT uk_ordenes_codigo UNIQUE (codigo_orden),
    CONSTRAINT chk_ordenes_codigo CHECK (LENGTH(TRIM(codigo_orden)) > 0),
    CONSTRAINT chk_ordenes_cafeteria_nombre CHECK (LENGTH(TRIM(cafeteria_nombre)) > 0),
    CONSTRAINT chk_ordenes_estado CHECK (estado IN ('REVISION_REQUERIDA', 'PENDIENTE_PAGO', 'PAGADO',
        'LISTO_PARA_RETIRO', 'ENTREGADO', 'NO_RETIRADO_PENDIENTE_REVISION', 'NO_RETIRADO_FINAL', 'CANCELADO')),
    CONSTRAINT chk_ordenes_monto CHECK (monto_total BETWEEN 0 AND 2000000000 AND monto_total = FLOOR(monto_total)),
    CONSTRAINT chk_ordenes_moneda CHECK (moneda = 'CLP'),
    CONSTRAINT chk_ordenes_version CHECK (version >= 0)
);
CREATE INDEX idx_ordenes_cafeteria_estado ON ordenes (cafeteria_id, estado, created_at DESC, id DESC);

CREATE TABLE orden_items (
    id UUID PRIMARY KEY,
    orden_id UUID NOT NULL,
    oferta_id UUID NOT NULL,
    producto_id UUID NOT NULL,
    producto_nombre VARCHAR(255) NOT NULL,
    cantidad INTEGER NOT NULL,
    precio_unitario NUMERIC(12, 2) NOT NULL,
    subtotal NUMERIC(12, 2) NOT NULL,
    CONSTRAINT fk_orden_items_orden FOREIGN KEY (orden_id) REFERENCES ordenes(id) ON DELETE RESTRICT,
    CONSTRAINT uk_orden_items_oferta UNIQUE (orden_id, oferta_id),
    CONSTRAINT chk_orden_items_nombre CHECK (LENGTH(TRIM(producto_nombre)) > 0),
    CONSTRAINT chk_orden_items_cantidad CHECK (cantidad BETWEEN 1 AND 100),
    CONSTRAINT chk_orden_items_precio CHECK (precio_unitario BETWEEN 0 AND 2000000000 AND precio_unitario = FLOOR(precio_unitario)),
    CONSTRAINT chk_orden_items_subtotal CHECK (subtotal BETWEEN 0 AND 2000000000
        AND subtotal = cantidad * precio_unitario)
);
