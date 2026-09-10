-- Flyway owns every schema change for catalog-service from this version onward.
CREATE SCHEMA IF NOT EXISTS public;

COMMENT ON SCHEMA public IS 'Flyway-managed schema for catalog-service';
