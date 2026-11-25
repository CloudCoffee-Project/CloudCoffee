package cl.cloudcoffee.catalog_service.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

public record EditarCategoriaRequest(
        @Size(min = 1, max = 100) String nombre,
        @Size(min = 1, max = 500) String descripcion,
        @Min(1) long version) {
}
