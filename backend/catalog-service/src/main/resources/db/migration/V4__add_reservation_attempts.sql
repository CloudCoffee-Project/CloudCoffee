-- Existing reservations remain the implicit legacy attempt; no history is discarded.
ALTER TABLE stock_reservation
    ADD COLUMN attempt_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';

ALTER TABLE stock_reservation DROP CONSTRAINT uq_stock_reservation_order_offer;
ALTER TABLE stock_reservation
    ADD CONSTRAINT uq_stock_reservation_attempt UNIQUE (order_id, offer_id, attempt_id);
