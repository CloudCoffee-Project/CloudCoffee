package cl.cloudcoffee.catalog_service.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CrearCampusRequest(
        @NotBlank @Size(max = 100) String nombre,
        @Size(max = 255) String direccion
) {}
