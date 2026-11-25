package cl.cloudcoffee.catalog_service.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CrearCategoriaRequest(
        @NotBlank @Size(max = 100) String nombre,
        @Size(min = 1, max = 500) String descripcion) {
}
