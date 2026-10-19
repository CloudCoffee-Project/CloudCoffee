-- INT2-76: compras de prueba para simular pagos. Solo se cargan con el perfil `dev`
-- (application-dev.yml agrega classpath:db/seed/dev a spring.flyway.locations).
--
-- usuario_id son las cuentas del seed de auth-service (INT2-65):
--   66666666-6666-4666-8666-666666666601  comprador@cloudcoffee.dev
--   66666666-6666-4666-8666-666666666602  cajero.central@cloudcoffee.dev (compra ajena al comprador)
--
-- Migración repetible e idempotente: UUID fijos y MERGE por id. No crea pagos:
-- se generan con POST /v1/compras/{compraId}/pago/simulacion.

MERGE INTO compras t
USING (VALUES
    ('77777777-7777-4777-8777-777777777701', '66666666-6666-4666-8666-666666666601', 3700.00),
    ('77777777-7777-4777-8777-777777777702', '66666666-6666-4666-8666-666666666601', 900.00),
    ('77777777-7777-4777-8777-777777777703', '66666666-6666-4666-8666-666666666602', 1500.00)
) AS s (id, usuario_id, monto_total)
ON t.id = CAST(s.id AS UUID)
WHEN MATCHED THEN
    UPDATE SET usuario_id = CAST(s.usuario_id AS UUID), monto_total = s.monto_total
WHEN NOT MATCHED THEN
    INSERT (id, usuario_id, monto_total, created_at)
    VALUES (CAST(s.id AS UUID), CAST(s.usuario_id AS UUID), s.monto_total, CURRENT_TIMESTAMP);
