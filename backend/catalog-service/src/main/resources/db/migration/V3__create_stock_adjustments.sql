ALTER TABLE offer ADD COLUMN version BIGINT NOT NULL DEFAULT 0;

CREATE TABLE stock_adjustment (
    id UUID PRIMARY KEY,
    offer_id UUID NOT NULL REFERENCES offer (id),
    adjusted_by UUID NOT NULL,
    quantity INT NOT NULL CHECK (quantity >= 0),
    reserved_quantity BIGINT NOT NULL CHECK (reserved_quantity >= 0),
    previous_stock INT NOT NULL CHECK (previous_stock >= 0),
    stock INT NOT NULL CHECK (stock >= 0),
    version BIGINT NOT NULL,
    adjusted_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT ck_stock_adjustment_total CHECK (quantity = stock + reserved_quantity)
);

CREATE INDEX ix_stock_adjustment_offer_time ON stock_adjustment (offer_id, adjusted_at);
