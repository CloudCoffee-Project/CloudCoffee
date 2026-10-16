-- INT2-53: compras y pagos simulados.
--
-- compras es la base mínima a la que se vinculan los pagos; ítems y estado de la
-- compra llegan con sus propios tickets. usuario_id es el `sub` del JWT emitido
-- por auth-service, guardado por valor (sin tablas compartidas entre servicios).
CREATE TABLE compras (
    id              UUID PRIMARY KEY,
    usuario_id      UUID NOT NULL,
    -- Calculado por el servidor a partir de las ofertas; nunca enviado por el cliente.
    monto_total     NUMERIC(10, 2) NOT NULL,
    created_at      TIMESTAMP NOT NULL,

    CONSTRAINT chk_compras_monto_total CHECK (monto_total > 0)
);

CREATE INDEX idx_compras_usuario_id ON compras (usuario_id);

-- Una compra puede tener varios intentos de pago (p. ej. reintento tras un rechazo);
-- el servicio impide que coexistan dos pagos PENDIENTE o APROBADO para la misma compra.
CREATE TABLE pagos (
    id                      UUID PRIMARY KEY,
    compra_id               UUID NOT NULL,
    estado                  VARCHAR(20) NOT NULL,
    -- Copiado de compras.monto_total al iniciar el pago.
    monto                   NUMERIC(10, 2) NOT NULL,
    proveedor               VARCHAR(30) NOT NULL,
    referencia_proveedor    VARCHAR(100),
    motivo_rechazo          VARCHAR(255),
    version                 BIGINT NOT NULL,
    created_at              TIMESTAMP NOT NULL,
    updated_at              TIMESTAMP,

    CONSTRAINT fk_pagos_compra FOREIGN KEY (compra_id) REFERENCES compras (id),
    CONSTRAINT chk_pagos_estado CHECK (estado IN ('PENDIENTE', 'APROBADO', 'RECHAZADO')),
    CONSTRAINT chk_pagos_monto CHECK (monto > 0),
    CONSTRAINT uk_pagos_proveedor_referencia UNIQUE (proveedor, referencia_proveedor)
);

CREATE INDEX idx_pagos_compra_id ON pagos (compra_id);
