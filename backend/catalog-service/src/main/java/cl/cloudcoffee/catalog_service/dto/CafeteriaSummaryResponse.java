package cl.cloudcoffee.catalog_service.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.UUID;

import cl.cloudcoffee.catalog_service.model.entity.Cafeteria;

public record CafeteriaSummaryResponse(
        @Schema(description = "Identificador UUID", example = "11111111-1111-4111-8111-111111111111")
        UUID id,
        @Schema(description = "Nombre", example = "Cafetería Ejemplo")
        String nombre
) {

    public static CafeteriaSummaryResponse from(Cafeteria cafeteria) {
        return new CafeteriaSummaryResponse(cafeteria.getId(), cafeteria.getName());
    }
}
