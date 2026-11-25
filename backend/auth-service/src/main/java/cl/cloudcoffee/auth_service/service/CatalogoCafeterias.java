package cl.cloudcoffee.auth_service.service;

import java.util.Optional;
import java.util.UUID;

/**
 * Consulta interna a Catalog ({@code GET /internal/servicios/catalogo/cafeterias/{id}}) para validar
 * la cafetería al invitar o reasignar personal, sin compartir tablas (INT2-109).
 */
public interface CatalogoCafeterias {

    /**
     * @return vacío si Catalog confirma que la cafetería no existe; {@code activa} indica si sigue vigente.
     * @throws OperacionPendienteException si Catalog no responde o su respuesta no es verificable.
     */
    Optional<Cafeteria> consultar(UUID cafeteriaId);

    record Cafeteria(UUID cafeteriaId, boolean activa) {
    }
}
