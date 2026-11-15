-- INT2-116: seguimientos de productos para avisos de reposición.
--
-- cafeteria_id NULL es un seguimiento general (cualquier cafetería). Dos NULL no
-- chocan en un índice único, así que cafeteria_key guarda el UUID nulo para el
-- general y la unicidad usuario/producto/cafetería usa esa columna. Así funciona
-- igual en PostgreSQL y en H2, sin índices parciales.
--
-- La baja es lógica (deleted_at): repetirla es idempotente y volver a seguir
-- reactiva la misma fila, sin violar la unicidad.
CREATE TABLE product_follow (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    product_id UUID NOT NULL,
    cafeteria_id UUID,
    cafeteria_key UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT fk_product_follow_product FOREIGN KEY (product_id) REFERENCES product (id),
    CONSTRAINT fk_product_follow_cafeteria FOREIGN KEY (cafeteria_id) REFERENCES cafeteria (id),
    CONSTRAINT uq_product_follow_user_product_cafeteria UNIQUE (user_id, product_id, cafeteria_key),
    CONSTRAINT ck_product_follow_cafeteria_key CHECK (
        (cafeteria_id IS NULL AND cafeteria_key = '00000000-0000-0000-0000-000000000000')
        OR (cafeteria_id IS NOT NULL AND cafeteria_key = cafeteria_id))
);

CREATE INDEX ix_product_follow_user ON product_follow (user_id, deleted_at, created_at);
