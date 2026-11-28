-- INT2-122: cada cambio administrativo sobre una cuenta queda atribuido a quien lo hizo.
-- Registro de solo inserción; se escribe en la misma transacción que el cambio.
CREATE TABLE auditoria_cuentas (
    id            UUID         PRIMARY KEY,
    actor_id      UUID         NOT NULL,
    actor_rol     VARCHAR(30)  NOT NULL,
    accion        VARCHAR(40)  NOT NULL,
    usuario_id    UUID         NOT NULL,
    cafeteria_id  UUID,
    created_at    TIMESTAMP    NOT NULL,

    CONSTRAINT fk_auditoria_cuentas_actor FOREIGN KEY (actor_id) REFERENCES usuarios (id),
    CONSTRAINT fk_auditoria_cuentas_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
    CONSTRAINT chk_auditoria_cuentas_accion CHECK (accion IN ('INVITAR', 'REENVIAR_INVITACION', 'EDITAR',
        'REASIGNAR', 'DESACTIVAR', 'REACTIVAR', 'DAR_DE_BAJA'))
);

CREATE INDEX idx_auditoria_cuentas_usuario ON auditoria_cuentas (usuario_id, created_at);
CREATE INDEX idx_auditoria_cuentas_actor ON auditoria_cuentas (actor_id, created_at);
