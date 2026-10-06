package cl.cloudcoffee.catalog_service.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.Comparator;
import java.util.List;
import java.util.UUID;

import cl.cloudcoffee.catalog_service.model.entity.Campus;

public record CampusResponse(
        @Schema(description = "Identificador UUID", example = "11111111-1111-4111-8111-111111111111")
        UUID id,
        @Schema(description = "Nombre", example = "Campus Ejemplo")
        String nombre,
        @Schema(description = "Dirección del campus", example = "Avenida Ejemplo 123")
        String direccion,
        @Schema(description = "Cafeterías del campus")
        List<CafeteriaSummaryResponse> cafeterias
) {

    public static CampusResponse from(Campus campus) {
        List<CafeteriaSummaryResponse> cafeterias = campus.getCafeterias() == null
                ? List.of()
                : campus.getCafeterias().stream()
                        .map(CafeteriaSummaryResponse::from)
                        .sorted(Comparator.comparing(CafeteriaSummaryResponse::nombre))
                        .toList();

        return new CampusResponse(
                campus.getId(),
                campus.getName(),
                campus.getLocation(),
                cafeterias
        );
    }
}
