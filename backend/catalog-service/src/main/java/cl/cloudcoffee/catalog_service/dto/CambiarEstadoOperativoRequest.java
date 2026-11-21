package cl.cloudcoffee.catalog_service.dto;

import cl.cloudcoffee.catalog_service.model.enums.CafeteriaStatus;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

public record CambiarEstadoOperativoRequest(
        @NotNull CafeteriaStatus estadoOperativo,
        @Min(1) long version
) {}
