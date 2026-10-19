-- INT2-76: pago simulado conforme al contrato de INT2-50 (#112).

-- Motivo del estado del pago. Se guarda el nombre del enum; la API lo expone en
-- snake_case minúscula (aprobacion_simulada, rechazo_simulado, ...).
ALTER TABLE pagos ADD COLUMN motivo VARCHAR(30);
ALTER TABLE pagos ADD CONSTRAINT chk_pagos_motivo CHECK (motivo IS NULL OR motivo IN (
    'APROBACION_SIMULADA', 'RECHAZO_SIMULADO', 'ESCENARIO_PENDIENTE',
    'PROCESANDO_STOCK', 'RESERVA_VENCIDA', 'COMPRA_CANCELADA'));

-- Registro de idempotencia por intención: la tupla (usuario, método, ruta canónica,
-- clave) es única. Guarda el hash del cuerpo normalizado y la primera respuesta
-- terminada (código, cuerpo y Location) para reproducirla tal cual al repetir la clave.
CREATE TABLE idempotencia (
    id              UUID PRIMARY KEY,
    usuario_id      UUID NOT NULL,
    metodo          VARCHAR(10) NOT NULL,
    ruta            VARCHAR(255) NOT NULL,
    clave           UUID NOT NULL,
    hash_cuerpo     VARCHAR(64) NOT NULL,
    status          INT NOT NULL,
    cuerpo          TEXT NOT NULL,
    location        VARCHAR(255),
    created_at      TIMESTAMP NOT NULL,

    CONSTRAINT uk_idempotencia_intencion UNIQUE (usuario_id, metodo, ruta, clave)
);
