-- INT2-121 (contrato INT2-109): administración de cuentas por SUPER_ADMIN.

-- Versión optimista de la cuenta: las ediciones envían la última leída (409 VERSION_CONFLICTO).
ALTER TABLE usuarios ADD COLUMN version BIGINT DEFAULT 1 NOT NULL;

-- Token de un solo uso con el que el personal invitado define su contraseña.
ALTER TABLE tokens_auth DROP CONSTRAINT chk_tokens_auth_tipo;
ALTER TABLE tokens_auth ADD CONSTRAINT chk_tokens_auth_tipo
    CHECK (tipo IN ('REFRESH', 'VERIFICACION_CORREO', 'RECUPERACION_PASSWORD', 'ACTIVACION_CUENTA'));

-- Idempotency-Key de las altas administrativas, por actor: misma clave y cuerpo reproducen
-- el alta; misma clave con otro cuerpo responde 409 IDEMPOTENCY_CONFLICT.
CREATE TABLE idempotencias_admin (
    actor_id      UUID         NOT NULL,
    clave         UUID         NOT NULL,
    operacion     VARCHAR(40)  NOT NULL,
    hash_cuerpo   VARCHAR(64)  NOT NULL,
    usuario_id    UUID         NOT NULL,
    created_at    TIMESTAMP    NOT NULL,

    CONSTRAINT pk_idempotencias_admin PRIMARY KEY (actor_id, clave),
    CONSTRAINT fk_idempotencias_admin_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
);
