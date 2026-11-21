package cl.cloudcoffee.catalog_service.dto;

import java.time.Instant;
import java.util.UUID;
import cl.cloudcoffee.catalog_service.model.entity.Cafeteria;
import cl.cloudcoffee.catalog_service.model.enums.CafeteriaStatus;

public record CafeteriaResponse(
        UUID cafeteriaId,
        UUID campusId,
        String nombre,
        CafeteriaStatus estadoOperativo,
        boolean activa,
        Instant bajaAt,
        long version
) {
    public static CafeteriaResponse from(Cafeteria cafeteria) {
        return new CafeteriaResponse(cafeteria.getId(), cafeteria.getCampus().getId(), cafeteria.getName(),
                cafeteria.getStatus(), cafeteria.isActive(), cafeteria.getBajaAt(), cafeteria.getVersion());
    }
}
