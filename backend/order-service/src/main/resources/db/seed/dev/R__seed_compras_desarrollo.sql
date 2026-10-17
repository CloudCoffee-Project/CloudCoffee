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

-- INT2-77: reservas sobre las ofertas del seed de catalog-service (INT2-36), en
-- Cafetería Central. Vencen a 30 días para que no expiren mientras se prueba; los
-- nuevos MERGE no reactivan reservas ya confirmadas o liberadas.
--   701: Café americano (55..501, 1500) + Cappuccino (55..502, 2200) = 3700
--   702: Medialuna (55..505, 900)
--   703: Café americano (55..501, 1500)
MERGE INTO reservas t
USING (VALUES
    ('88888888-8888-4888-8888-888888888801', '77777777-7777-4777-8777-777777777701', '55555555-5555-4555-8555-555555555501', 1),
    ('88888888-8888-4888-8888-888888888802', '77777777-7777-4777-8777-777777777701', '55555555-5555-4555-8555-555555555502', 1),
    ('88888888-8888-4888-8888-888888888803', '77777777-7777-4777-8777-777777777702', '55555555-5555-4555-8555-555555555505', 1),
    ('88888888-8888-4888-8888-888888888804', '77777777-7777-4777-8777-777777777703', '55555555-5555-4555-8555-555555555501', 1)
) AS s (id, compra_id, oferta_id, cantidad)
ON t.id = CAST(s.id AS UUID)
WHEN NOT MATCHED THEN
    INSERT (id, compra_id, oferta_id, cantidad, estado, vence_en, created_at)
    VALUES (CAST(s.id AS UUID), CAST(s.compra_id AS UUID), CAST(s.oferta_id AS UUID), s.cantidad,
            'ACTIVA', CURRENT_TIMESTAMP + INTERVAL '30' DAY, CURRENT_TIMESTAMP);
