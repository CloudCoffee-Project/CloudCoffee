-- INT2-76: registro de comandos de simulación de pago por clave de idempotencia.
-- Repetir un comando con la misma clave para la misma compra devuelve el pago ya
-- afectado en vez de crear otro.
CREATE TABLE comandos_pago_simulado (
    id              UUID PRIMARY KEY,
    compra_id       UUID NOT NULL,
    clave           VARCHAR(100) NOT NULL,
    pago_id         UUID NOT NULL,
    escenario       VARCHAR(20) NOT NULL,
    created_at      TIMESTAMP NOT NULL,

    CONSTRAINT fk_comandos_pago_simulado_compra FOREIGN KEY (compra_id) REFERENCES compras (id),
    CONSTRAINT fk_comandos_pago_simulado_pago FOREIGN KEY (pago_id) REFERENCES pagos (id),
    CONSTRAINT chk_comandos_pago_simulado_escenario CHECK (escenario IN ('PENDIENTE', 'APROBADO', 'RECHAZADO')),
    CONSTRAINT uk_comandos_pago_simulado_compra_clave UNIQUE (compra_id, clave)
);
