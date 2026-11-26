ALTER TABLE offer
    ADD COLUMN administrative_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE offer
    ADD COLUMN baja_at TIMESTAMP;

CREATE INDEX ix_offer_cafeteria_administrative
    ON offer (cafeteria_id, administrative_active);
