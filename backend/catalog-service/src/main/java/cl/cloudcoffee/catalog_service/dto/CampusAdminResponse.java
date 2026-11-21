package cl.cloudcoffee.catalog_service.dto;

import java.time.Instant;
import java.util.UUID;
import cl.cloudcoffee.catalog_service.model.entity.Campus;

public record CampusAdminResponse(UUID campusId, String nombre, String direccion, boolean activo,
                                  Instant bajaAt, long version) {
    public static CampusAdminResponse from(Campus campus) {
        return new CampusAdminResponse(campus.getId(), campus.getName(), campus.getLocation(),
                campus.isActive(), campus.getBajaAt(), campus.getVersion());
    }
}
