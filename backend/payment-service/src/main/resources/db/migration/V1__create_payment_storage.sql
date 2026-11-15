-- Payment owns these tables; compra_id/cliente_id are external references, never cross-service FKs.
CREATE TABLE payment_intent (
    id UUID PRIMARY KEY,
    compra_id UUID NOT NULL UNIQUE,
    cliente_id UUID NOT NULL,
    idempotency_key UUID NOT NULL UNIQUE,
    request_hash VARCHAR(64) NOT NULL CHECK (CHAR_LENGTH(request_hash) = 64),
    request_payload TEXT NOT NULL,
    amount NUMERIC(12, 0) NOT NULL CHECK (amount BETWEEN 1 AND 2000000000),
    currency VARCHAR(3) NOT NULL CHECK (currency = 'CLP'),
    provider VARCHAR(32) NOT NULL CHECK (provider = 'mercadopago_sandbox'),
    environment VARCHAR(16) NOT NULL CHECK (environment = 'sandbox'),
    external_reference VARCHAR(128) NOT NULL UNIQUE,
    return_channel VARCHAR(16) NOT NULL CHECK (return_channel IN ('web', 'mobile')),
    status VARCHAR(32) NOT NULL DEFAULT 'CREATING'
        CHECK (status IN ('CREATING', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'REQUIRES_RECONCILIATION')),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
    CHECK (expires_at > created_at)
);
CREATE INDEX idx_payment_intent_reconciliation ON payment_intent (status, updated_at);
CREATE INDEX idx_payment_intent_expiry ON payment_intent (status, expires_at);

CREATE TABLE payment_preference (
    id UUID PRIMARY KEY,
    payment_intent_id UUID NOT NULL UNIQUE REFERENCES payment_intent(id) ON DELETE RESTRICT,
    provider_preference_id VARCHAR(255) NOT NULL UNIQUE,
    init_point TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A preference can receive several distinct provider payments; preserve each observation.
CREATE TABLE provider_payment (
    id UUID PRIMARY KEY,
    payment_intent_id UUID NOT NULL REFERENCES payment_intent(id) ON DELETE RESTRICT,
    provider_payment_id VARCHAR(128) NOT NULL UNIQUE,
    provider_status VARCHAR(64) NOT NULL,
    provider_status_detail VARCHAR(128),
    amount NUMERIC(12, 0) NOT NULL CHECK (amount BETWEEN 1 AND 2000000000),
    currency VARCHAR(3) NOT NULL CHECK (currency = 'CLP'),
    live_mode BOOLEAN NOT NULL CHECK (live_mode = FALSE),
    provider_updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0)
);
CREATE INDEX idx_provider_payment_intent ON provider_payment (payment_intent_id);

-- Only authenticated, sanitized metadata is stored; never bearer tokens, signatures or card details.
CREATE TABLE payment_inbox (
    id UUID PRIMARY KEY,
    provider VARCHAR(32) NOT NULL CHECK (provider = 'mercadopago_sandbox'),
    notification_id VARCHAR(128) NOT NULL,
    provider_payment_id VARCHAR(128) NOT NULL,
    payload TEXT NOT NULL,
    trace_id VARCHAR(32) NOT NULL CHECK (CHAR_LENGTH(trace_id) = 32),
    status VARCHAR(16) NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'PROCESSED', 'DEAD')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_error_code VARCHAR(64),
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (provider, notification_id),
    CHECK ((status = 'PROCESSED' AND processed_at IS NOT NULL) OR (status <> 'PROCESSED' AND processed_at IS NULL))
);
CREATE INDEX idx_payment_inbox_pending ON payment_inbox (status, next_attempt_at);
CREATE INDEX idx_payment_inbox_resource ON payment_inbox (provider_payment_id);

CREATE TABLE payment_outbox (
    event_id UUID PRIMARY KEY,
    payment_intent_id UUID NOT NULL REFERENCES payment_intent(id) ON DELETE RESTRICT,
    aggregate_version BIGINT NOT NULL CHECK (aggregate_version >= 1),
    event_type VARCHAR(128) NOT NULL CHECK (event_type = 'payment.pago.resultado.v1'),
    exchange_name VARCHAR(128) NOT NULL DEFAULT 'cloudcoffee.events',
    routing_key VARCHAR(128) NOT NULL DEFAULT 'payment.pago.resultado.v1',
    payload TEXT NOT NULL,
    trace_id VARCHAR(32) NOT NULL CHECK (CHAR_LENGTH(trace_id) = 32),
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'DEAD')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_error_code VARCHAR(64),
    published_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (payment_intent_id, aggregate_version, event_type),
    CHECK ((status = 'PUBLISHED' AND published_at IS NOT NULL) OR (status <> 'PUBLISHED' AND published_at IS NULL))
);
CREATE INDEX idx_payment_outbox_pending ON payment_outbox (status, next_attempt_at);
