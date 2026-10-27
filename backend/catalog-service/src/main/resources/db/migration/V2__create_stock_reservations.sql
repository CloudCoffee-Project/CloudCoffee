CREATE TABLE stock_reservation (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL,
    offer_id UUID NOT NULL,
    quantity INT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'RESERVED',
    reserved_at TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_stock_reservation_offer FOREIGN KEY (offer_id) REFERENCES offer (id),
    CONSTRAINT uq_stock_reservation_order_offer UNIQUE (order_id, offer_id),
    CONSTRAINT ck_stock_reservation_quantity_positive CHECK (quantity > 0),
    CONSTRAINT ck_stock_reservation_status CHECK (status IN ('RESERVED', 'CONFIRMED', 'RELEASED', 'EXPIRED')),
    CONSTRAINT ck_stock_reservation_expiry CHECK (expires_at > reserved_at)
);

CREATE INDEX ix_stock_reservation_expiration
    ON stock_reservation (status, expires_at, offer_id);
