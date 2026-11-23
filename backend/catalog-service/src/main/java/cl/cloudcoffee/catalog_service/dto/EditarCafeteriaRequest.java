package cl.cloudcoffee.catalog_service.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

public record EditarCafeteriaRequest(
        @Size(max = 150) String nombre,
        @Min(1) long version
) {}
