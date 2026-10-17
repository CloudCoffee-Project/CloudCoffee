-- INT2-77: eventos ya aplicados, para que una entrega repetida de RabbitMQ no
-- descuente el stock dos veces.
CREATE TABLE eventos_procesados (
    event_id        UUID PRIMARY KEY,
    event_type      VARCHAR(100) NOT NULL,
    procesado_en    TIMESTAMP NOT NULL
);
