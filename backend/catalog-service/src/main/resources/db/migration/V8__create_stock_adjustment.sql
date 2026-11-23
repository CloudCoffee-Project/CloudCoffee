CREATE TABLE stock_adjustment (
    id UUID PRIMARY KEY,
    offer_id UUID NOT NULL REFERENCES offer (id),
    adjusted_by UUID NOT NULL,
    idempotency_key UUID NOT NULL,
    quantity INT NOT NULL CHECK (quantity BETWEEN -10000 AND 10000 AND quantity <> 0),
    reason VARCHAR(32) NOT NULL CHECK (reason IN ('REPOSICION', 'MERMA', 'CORRECCION_INVENTARIO', 'REINGRESO_NO_RETIRADO')),
    note VARCHAR(200),
    previous_stock INT NOT NULL CHECK (previous_stock >= 0),
    stock INT NOT NULL CHECK (stock >= 0),
    adjusted_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uq_stock_adjustment_intent UNIQUE (offer_id, adjusted_by, idempotency_key),
    CONSTRAINT ck_stock_adjustment_delta CHECK (stock = CAST(previous_stock AS BIGINT) + quantity)
);

CREATE INDEX ix_stock_reservation_offer_status ON stock_reservation (offer_id, status);
