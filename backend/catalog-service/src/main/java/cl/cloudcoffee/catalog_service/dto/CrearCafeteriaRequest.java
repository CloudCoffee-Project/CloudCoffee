package cl.cloudcoffee.catalog_service.dto;

import java.util.UUID;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record CrearCafeteriaRequest(
        @NotNull UUID campusId,
        @NotBlank @Size(max = 150) String nombre
) {}
