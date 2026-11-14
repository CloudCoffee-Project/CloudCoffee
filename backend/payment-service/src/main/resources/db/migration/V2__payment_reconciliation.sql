-- INT2-112: conciliación de pagos. Migración aditiva: no modifica datos ni constraints de V1.

-- Motivo del último cambio de estado (por ejemplo aprobacion_tardia) y última consulta al proveedor.
ALTER TABLE payment_intent ADD COLUMN status_reason VARCHAR(64);
ALTER TABLE payment_intent ADD COLUMN provider_checked_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX idx_payment_intent_checked ON payment_intent (status, provider_checked_at);

-- Evidencia de pagos que no calzan con la intención (monto, moneda, entorno, referencia ajena o estado
-- desconocido). Puede no tener intención (referencia ajena) y nunca se borra automáticamente.
-- Guarda solo campos saneados del proveedor: nunca datos del pagador, tarjeta, firmas ni tokens.
CREATE TABLE payment_anomaly (
    id UUID PRIMARY KEY,
    payment_intent_id UUID REFERENCES payment_intent(id) ON DELETE RESTRICT,
    provider_payment_id VARCHAR(128) NOT NULL,
    reason VARCHAR(64) NOT NULL,
    evidence TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (provider_payment_id, reason)
);
CREATE INDEX idx_payment_anomaly_intent ON payment_anomaly (payment_intent_id);
