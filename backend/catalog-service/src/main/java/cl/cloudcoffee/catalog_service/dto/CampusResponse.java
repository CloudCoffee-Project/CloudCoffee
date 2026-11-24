package cl.cloudcoffee.catalog_service.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.Comparator;
import java.util.List;
import java.util.UUID;

import cl.cloudcoffee.catalog_service.model.entity.Cafeteria;
import cl.cloudcoffee.catalog_service.model.entity.Campus;
import cl.cloudcoffee.catalog_service.model.enums.CafeteriaStatus;

public record CampusResponse(
        @Schema(description = "Identificador UUID", example = "11111111-1111-4111-8111-111111111111")
        UUID id,
        @Schema(description = "Nombre", example = "Campus Ejemplo")
        String nombre,
        @Schema(description = "Dirección del campus", example = "Avenida Ejemplo 123")
        String direccion,
        @Schema(description = "Cafeterías del campus")
        List<CafeteriaSummaryResponse> cafeterias,
        @Schema(description = "Cantidad de cafeterías abiertas del campus", example = "2")
        long cafeteriasActivas
) {

    public static CampusResponse from(Campus campus) {
        List<Cafeteria> cafeteriasDelCampus = campus.getCafeterias() == null
                ? List.of() : campus.getCafeterias();
        List<CafeteriaSummaryResponse> cafeterias = cafeteriasDelCampus.stream()
                .map(CafeteriaSummaryResponse::from)
                .sorted(Comparator.comparing(CafeteriaSummaryResponse::nombre))
                .toList();
        long cafeteriasActivas = cafeteriasDelCampus.stream()
                .filter(cafeteria -> cafeteria.getStatus() == CafeteriaStatus.OPEN)
                .count();

        return new CampusResponse(
                campus.getId(),
                campus.getName(),
                campus.getLocation(),
                cafeterias,
                cafeteriasActivas
        );
    }
}
