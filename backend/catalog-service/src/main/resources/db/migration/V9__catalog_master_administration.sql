ALTER TABLE category ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE category ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE category ADD COLUMN name_key VARCHAR(100);
UPDATE category SET name_key = LOWER(name);
ALTER TABLE product ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE product ADD COLUMN name_key VARCHAR(150);
UPDATE product SET name_key = LOWER(name);

CREATE UNIQUE INDEX uq_category_name_key ON category (name_key);
CREATE UNIQUE INDEX uq_product_name_key ON product (name_key);

CREATE TABLE catalog_audit (
    id UUID PRIMARY KEY,
    resource_type VARCHAR(32) NOT NULL,
    resource_id UUID NOT NULL,
    action VARCHAR(32) NOT NULL,
    actor_id VARCHAR(36),
    detail VARCHAR(1000),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_catalog_audit_resource ON catalog_audit (resource_type, resource_id, created_at);

CREATE TABLE catalog_idempotency (
    id UUID PRIMARY KEY,
    resource_type VARCHAR(32) NOT NULL,
    actor_id VARCHAR(36) NOT NULL,
    idempotency_key UUID NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    resource_id UUID NOT NULL,
    response_body TEXT NOT NULL,
    CONSTRAINT uq_catalog_idempotency UNIQUE (resource_type, actor_id, idempotency_key)
);
