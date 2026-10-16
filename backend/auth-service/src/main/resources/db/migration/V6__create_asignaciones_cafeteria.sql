-- INT2-65: cafetería asignada a cada cajero o administrador de cafetería.
-- cafeteria_id es el UUID de catalog-service guardado por valor: cada servicio
-- tiene su propia base, así que no hay FK ni tablas compartidas entre ellos.
CREATE TABLE asignaciones_cafeteria (
    usuario_id      UUID PRIMARY KEY,
    cafeteria_id    UUID NOT NULL,
    created_at      TIMESTAMP NOT NULL,

    CONSTRAINT fk_asignaciones_cafeteria_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
);

CREATE INDEX idx_asignaciones_cafeteria_cafeteria_id ON asignaciones_cafeteria (cafeteria_id);
