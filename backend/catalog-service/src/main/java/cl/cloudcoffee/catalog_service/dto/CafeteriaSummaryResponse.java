package cl.cloudcoffee.catalog_service.dto;

import java.util.UUID;

import cl.cloudcoffee.catalog_service.model.entity.Cafeteria;

public record CafeteriaSummaryResponse(
        UUID id,
        String nombre
) {

    public static CafeteriaSummaryResponse from(Cafeteria cafeteria) {
        return new CafeteriaSummaryResponse(cafeteria.getId(), cafeteria.getName());
    }
}
