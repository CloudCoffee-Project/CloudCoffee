-- INT2-36: catálogo de desarrollo. Solo se carga con el perfil `dev`
-- (application-dev.yml agrega classpath:db/seed/dev a spring.flyway.locations).
--
-- Migración repetible: Flyway la vuelve a ejecutar cuando cambia su checksum.
-- Los UUID son fijos y cada MERGE actualiza o inserta, así que re-ejecutarla
-- no duplica filas ni toca datos creados a mano. Los UUID del primer campus,
-- categoría, producto y cafetería coinciden con los ejemplos de Swagger.
--
-- Casos que el seed deja reproducibles:
--   * Dos campus; cafeterías OPEN, CLOSED y MAINTENANCE.
--   * Un mismo producto con precios distintos por cafetería (comparación).
--   * Stock variado: alto, bajo y cero con oferta AVAILABLE (disponible=false).
--   * Ofertas que nunca se publican: cafetería no OPEN u oferta OUT_OF_STOCK.
--   * Búsqueda por descripción: "Frappé moca" solo menciona "café" en la descripción.

MERGE INTO campus t
USING (VALUES
    ('11111111-1111-4111-8111-111111111111', 'Campus San Francisco', 'Manuel Montt 056, Temuco'),
    ('11111111-1111-4111-8111-111111111112', 'Campus San Juan Pablo II', 'Rudecindo Ortega 02950, Temuco')
) AS s (id, name, location)
ON t.id = CAST(s.id AS UUID)
WHEN MATCHED THEN
    UPDATE SET name = s.name, location = s.location
WHEN NOT MATCHED THEN
    INSERT (id, name, location) VALUES (CAST(s.id AS UUID), s.name, s.location);

MERGE INTO category t
USING (VALUES
    ('22222222-2222-4222-8222-222222222222', 'Cafés', 'Café de grano preparado en barra'),
    ('22222222-2222-4222-8222-222222222223', 'Bebidas frías', 'Jugos, aguas y bebidas heladas'),
    ('22222222-2222-4222-8222-222222222224', 'Pastelería', 'Dulces y masas horneadas'),
    ('22222222-2222-4222-8222-222222222225', 'Sándwiches', 'Sándwiches fríos y calientes')
) AS s (id, name, description)
ON t.id = CAST(s.id AS UUID)
WHEN MATCHED THEN
    UPDATE SET name = s.name, description = s.description
WHEN NOT MATCHED THEN
    INSERT (id, name, description) VALUES (CAST(s.id AS UUID), s.name, s.description);

MERGE INTO cafeteria t
USING (VALUES
    ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'Cafetería Central', 'OPEN'),
    ('44444444-4444-4444-8444-444444444445', '11111111-1111-4111-8111-111111111111', 'Cafetería Biblioteca', 'OPEN'),
    ('44444444-4444-4444-8444-444444444446', '11111111-1111-4111-8111-111111111111', 'Cafetería Ingeniería', 'CLOSED'),
    ('44444444-4444-4444-8444-444444444447', '11111111-1111-4111-8111-111111111112', 'Cafetería Patio Norte', 'OPEN'),
    ('44444444-4444-4444-8444-444444444448', '11111111-1111-4111-8111-111111111112', 'Kiosko Gimnasio', 'MAINTENANCE')
) AS s (id, campus_id, name, status)
ON t.id = CAST(s.id AS UUID)
WHEN MATCHED THEN
    UPDATE SET campus_id = CAST(s.campus_id AS UUID), name = s.name, status = s.status
WHEN NOT MATCHED THEN
    INSERT (id, campus_id, name, status)
    VALUES (CAST(s.id AS UUID), CAST(s.campus_id AS UUID), s.name, s.status);

MERGE INTO product t
USING (VALUES
    ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'Café americano', 'Café de filtro recién preparado'),
    ('33333333-3333-4333-8333-333333333334', '22222222-2222-4222-8222-222222222222', 'Cappuccino', 'Espresso con leche vaporizada y espuma'),
    ('33333333-3333-4333-8333-333333333335', '22222222-2222-4222-8222-222222222222', 'Latte de vainilla', 'Espresso, leche y jarabe de vainilla'),
    ('33333333-3333-4333-8333-333333333336', '22222222-2222-4222-8222-222222222223', 'Café helado', 'Cold brew con hielo y leche'),
    ('33333333-3333-4333-8333-333333333337', '22222222-2222-4222-8222-222222222223', 'Frappé moca', 'Bebida helada de café y chocolate'),
    ('33333333-3333-4333-8333-333333333338', '22222222-2222-4222-8222-222222222223', 'Jugo natural de naranja', 'Naranja exprimida al momento'),
    ('33333333-3333-4333-8333-333333333339', '22222222-2222-4222-8222-222222222223', 'Agua mineral', 'Botella de 500 ml sin gas'),
    ('33333333-3333-4333-8333-33333333333a', '22222222-2222-4222-8222-222222222224', 'Medialuna', 'Masa de hojaldre horneada cada mañana'),
    ('33333333-3333-4333-8333-33333333333b', '22222222-2222-4222-8222-222222222224', 'Muffin de arándanos', 'Muffin esponjoso con arándanos'),
    ('33333333-3333-4333-8333-33333333333c', '22222222-2222-4222-8222-222222222224', 'Brownie', 'Brownie de chocolate con nueces'),
    ('33333333-3333-4333-8333-33333333333d', '22222222-2222-4222-8222-222222222225', 'Sándwich ave palta', 'Pan frica con pollo y palta'),
    ('33333333-3333-4333-8333-33333333333e', '22222222-2222-4222-8222-222222222225', 'Sándwich vegetariano', 'Pan integral con queso, tomate y palta')
) AS s (id, category_id, name, description)
ON t.id = CAST(s.id AS UUID)
WHEN MATCHED THEN
    UPDATE SET category_id = CAST(s.category_id AS UUID), name = s.name,
               description = s.description, status = 'ACTIVE'
WHEN NOT MATCHED THEN
    INSERT (id, category_id, name, description, status)
    VALUES (CAST(s.id AS UUID), CAST(s.category_id AS UUID), s.name, s.description, 'ACTIVE');

MERGE INTO offer t
USING (VALUES
    -- Campus San Francisco / Cafetería Central (OPEN)
    ('55555555-5555-4555-8555-555555555501', '44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', 1500.00, 40, 'AVAILABLE'),
    ('55555555-5555-4555-8555-555555555502', '44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333334', 2200.00, 25, 'AVAILABLE'),
    ('55555555-5555-4555-8555-555555555503', '44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333335', 2600.00, 0, 'AVAILABLE'),
    ('55555555-5555-4555-8555-555555555504', '44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333337', 2900.00, 8, 'AVAILABLE'),
    ('55555555-5555-4555-8555-555555555505', '44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-33333333333a', 900.00, 30, 'AVAILABLE'),
    ('55555555-5555-4555-8555-555555555506', '44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-33333333333d', 3500.00, 5, 'AVAILABLE'),
    ('55555555-5555-4555-8555-555555555507', '44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333339', 1000.00, 0, 'OUT_OF_STOCK'),
    -- Campus San Francisco / Cafetería Biblioteca (OPEN): americano más barato que en Central
    ('55555555-5555-4555-8555-555555555508', '44444444-4444-4444-8444-444444444445', '33333333-3333-4333-8333-333333333333', 1300.00, 3, 'AVAILABLE'),
    ('55555555-5555-4555-8555-555555555509', '44444444-4444-4444-8444-444444444445', '33333333-3333-4333-8333-333333333334', 2400.00, 12, 'AVAILABLE'),
    ('55555555-5555-4555-8555-55555555550a', '44444444-4444-4444-8444-444444444445', '33333333-3333-4333-8333-33333333333b', 1500.00, 10, 'AVAILABLE'),
    ('55555555-5555-4555-8555-55555555550b', '44444444-4444-4444-8444-444444444445', '33333333-3333-4333-8333-333333333338', 2000.00, 15, 'AVAILABLE'),
    -- Campus San Francisco / Cafetería Ingeniería (CLOSED): nunca se publica
    ('55555555-5555-4555-8555-55555555550c', '44444444-4444-4444-8444-444444444446', '33333333-3333-4333-8333-333333333333', 1100.00, 50, 'AVAILABLE'),
    ('55555555-5555-4555-8555-55555555550d', '44444444-4444-4444-8444-444444444446', '33333333-3333-4333-8333-33333333333c', 1200.00, 20, 'AVAILABLE'),
    -- Campus San Juan Pablo II / Cafetería Patio Norte (OPEN)
    ('55555555-5555-4555-8555-55555555550e', '44444444-4444-4444-8444-444444444447', '33333333-3333-4333-8333-333333333333', 1600.00, 20, 'AVAILABLE'),
    ('55555555-5555-4555-8555-55555555550f', '44444444-4444-4444-8444-444444444447', '33333333-3333-4333-8333-333333333336', 2300.00, 18, 'AVAILABLE'),
    ('55555555-5555-4555-8555-555555555510', '44444444-4444-4444-8444-444444444447', '33333333-3333-4333-8333-33333333333e', 3200.00, 6, 'AVAILABLE'),
    ('55555555-5555-4555-8555-555555555511', '44444444-4444-4444-8444-444444444447', '33333333-3333-4333-8333-33333333333a', 950.00, 0, 'AVAILABLE'),
    ('55555555-5555-4555-8555-555555555512', '44444444-4444-4444-8444-444444444447', '33333333-3333-4333-8333-333333333338', 2100.00, 9, 'AVAILABLE'),
    -- Campus San Juan Pablo II / Kiosko Gimnasio (MAINTENANCE): nunca se publica
    ('55555555-5555-4555-8555-555555555513', '44444444-4444-4444-8444-444444444448', '33333333-3333-4333-8333-33333333333c', 1250.00, 4, 'AVAILABLE'),
    ('55555555-5555-4555-8555-555555555514', '44444444-4444-4444-8444-444444444448', '33333333-3333-4333-8333-333333333339', 900.00, 40, 'AVAILABLE')
) AS s (id, cafeteria_id, product_id, price, stock, status)
ON t.id = CAST(s.id AS UUID)
WHEN MATCHED THEN
    UPDATE SET cafeteria_id = CAST(s.cafeteria_id AS UUID), product_id = CAST(s.product_id AS UUID),
               price = s.price, stock = s.stock, status = s.status
WHEN NOT MATCHED THEN
    INSERT (id, cafeteria_id, product_id, price, stock, status)
    VALUES (CAST(s.id AS UUID), CAST(s.cafeteria_id AS UUID), CAST(s.product_id AS UUID),
            s.price, s.stock, s.status);
