package cl.cloudcoffee.catalog_service.dto;

import java.util.Comparator;
import java.util.List;
import java.util.UUID;

import cl.cloudcoffee.catalog_service.model.entity.Campus;

public record CampusResponse(
        UUID id,
        String nombre,
        String direccion,
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
