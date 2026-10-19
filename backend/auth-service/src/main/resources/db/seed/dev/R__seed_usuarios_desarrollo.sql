-- INT2-65: cuentas de prueba. Solo se cargan con el perfil `dev`
-- (application-dev.yml agrega classpath:db/seed/dev a spring.flyway.locations).
--
-- Contraseña de todas las cuentas: CafeDemo123!  (hash BCrypt, costo 10)
-- Los cafeteria_id son los UUID fijos del seed de catalog-service (INT2-36):
--   44444444-4444-4444-8444-444444444444  Cafetería Central      (Campus San Francisco)
--   44444444-4444-4444-8444-444444444447  Cafetería Patio Norte  (Campus San Juan Pablo II)
--
-- Migración repetible e idempotente: UUID fijos y MERGE por id.

MERGE INTO usuarios t
USING (VALUES
    ('66666666-6666-4666-8666-666666666601', 'comprador@cloudcoffee.dev',         'CLIENTE',         'Camila', 'Compradora'),
    ('66666666-6666-4666-8666-666666666602', 'cajero.central@cloudcoffee.dev',    'CAJERO',          'Carlos', 'Central'),
    ('66666666-6666-4666-8666-666666666603', 'admin.central@cloudcoffee.dev',     'ADMIN_CAFETERIA', 'Andrea', 'Central'),
    ('66666666-6666-4666-8666-666666666604', 'cajero.patio@cloudcoffee.dev',      'CAJERO',          'Pedro',  'Patio Norte'),
    ('66666666-6666-4666-8666-666666666605', 'admin.patio@cloudcoffee.dev',       'ADMIN_CAFETERIA', 'Paula',  'Patio Norte'),
    ('66666666-6666-4666-8666-666666666606', 'cajero.sinasignar@cloudcoffee.dev', 'CAJERO',          'Simón',  'Sin Asignar')
) AS s (id, email, rol, nombre, apellido)
ON t.id = CAST(s.id AS UUID)
WHEN MATCHED THEN
    UPDATE SET email = s.email, rol = s.rol, nombre = s.nombre, apellido = s.apellido,
               password_hash = '$2a$10$FbsJlpdvfABBggOgqWlMRupXVSXTODBh7lDUfQ.5Tq2j.k4mHvNXq',
               verificado = TRUE, activo = TRUE, eliminado = FALSE, updated_at = CURRENT_TIMESTAMP
WHEN NOT MATCHED THEN
    INSERT (id, email, password_hash, rol, nombre, apellido, telefono, verificado, activo, eliminado, created_at)
    VALUES (CAST(s.id AS UUID), s.email, '$2a$10$FbsJlpdvfABBggOgqWlMRupXVSXTODBh7lDUfQ.5Tq2j.k4mHvNXq',
            s.rol, s.nombre, s.apellido, '+56 9 0000 0000', TRUE, TRUE, FALSE, CURRENT_TIMESTAMP);

MERGE INTO asignaciones_cafeteria t
USING (VALUES
    ('66666666-6666-4666-8666-666666666602', '44444444-4444-4444-8444-444444444444'),
    ('66666666-6666-4666-8666-666666666603', '44444444-4444-4444-8444-444444444444'),
    ('66666666-6666-4666-8666-666666666604', '44444444-4444-4444-8444-444444444447'),
    ('66666666-6666-4666-8666-666666666605', '44444444-4444-4444-8444-444444444447')
) AS s (usuario_id, cafeteria_id)
ON t.usuario_id = CAST(s.usuario_id AS UUID)
WHEN MATCHED THEN
    UPDATE SET cafeteria_id = CAST(s.cafeteria_id AS UUID)
WHEN NOT MATCHED THEN
    INSERT (usuario_id, cafeteria_id, created_at)
    VALUES (CAST(s.usuario_id AS UUID), CAST(s.cafeteria_id AS UUID), CURRENT_TIMESTAMP);

-- El cajero sin asignación existe para probar que no opera ninguna cafetería.
DELETE FROM asignaciones_cafeteria WHERE usuario_id = '66666666-6666-4666-8666-666666666606';
