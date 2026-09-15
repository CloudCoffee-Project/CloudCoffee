CREATE TABLE usuarios (
    id              UUID PRIMARY KEY,
    email           VARCHAR(255) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    rol             VARCHAR(30) NOT NULL,
    verificado      BOOLEAN NOT NULL DEFAULT FALSE,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    eliminado       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMP NOT NULL,
    updated_at      TIMESTAMP,

    CONSTRAINT uk_usuarios_email UNIQUE (email),
    CONSTRAINT chk_usuarios_rol CHECK (rol IN ('CLIENTE', 'CAJERO', 'ADMIN_CAFETERIA', 'SUPER_ADMIN'))
);

CREATE TABLE tokens_auth (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL,
    token_hash      VARCHAR(255) NOT NULL,
    expires_at      TIMESTAMP NOT NULL,
    revoked_at      TIMESTAMP,
    created_at      TIMESTAMP NOT NULL,

    CONSTRAINT uk_tokens_auth_token_hash UNIQUE (token_hash),
    CONSTRAINT fk_tokens_auth_usuario FOREIGN KEY (user_id) REFERENCES usuarios (id)
);

CREATE INDEX idx_tokens_auth_user_id ON tokens_auth (user_id);