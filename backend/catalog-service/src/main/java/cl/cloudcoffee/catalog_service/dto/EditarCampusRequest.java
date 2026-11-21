package cl.cloudcoffee.catalog_service.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

public record EditarCampusRequest(
        @Size(max = 100) String nombre,
        @Size(max = 255) String direccion,
        @Min(1) long version
) {}
