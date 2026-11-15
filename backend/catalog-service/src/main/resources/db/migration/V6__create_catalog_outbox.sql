-- INT2-64: event and stock mutation commit or roll back together in Catalog's database.
-- Keep the serialized envelope immutable, including eventId, traceId, timestamp and recipients.
CREATE TABLE catalog_outbox (
    event_id UUID PRIMARY KEY,
    event_type VARCHAR(128) NOT NULL CHECK (CHAR_LENGTH(TRIM(event_type)) > 0),
    cuerpo TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    publicado BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_catalog_outbox_pendiente ON catalog_outbox (publicado, created_at, event_id);
