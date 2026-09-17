-- Flyway owns every schema change for catalog-service from this version onward.
CREATE SCHEMA IF NOT EXISTS public;

COMMENT ON SCHEMA public IS 'Flyway-managed schema for catalog-service';

CREATE TABLE campus (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    location VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP

);

CREATE TABLE category (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE cafeteria (
    id UUID PRIMARY KEY,
    campus_id UUID NOT NULL,
    name VARCHAR(150) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_cafeteria_campus FOREIGN KEY (campus_id) REFERENCES campus (id)
);

CREATE TABLE product (
    id UUID PRIMARY KEY,
    category_id UUID NOT NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    image_url VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_product_category FOREIGN KEY (category_id) REFERENCES category (id)
);

CREATE TABLE offer (
    id UUID PRIMARY KEY,
    cafeteria_id UUID NOT NULL,
    product_id UUID NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    stock INT NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'AVAILABLE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_offer_cafeteria FOREIGN KEY (cafeteria_id) REFERENCES cafeteria (id),
    CONSTRAINT fk_offer_product FOREIGN KEY (product_id) REFERENCES product (id),
    CONSTRAINT uq_cafeteria_product UNIQUE(cafeteria_id, product_id)
);
