package cl.cloudcoffee.catalog_service.dto;

import java.net.URI;
import java.util.UUID;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CrearProductoRequest(
        @NotNull UUID categoriaId,
        @NotBlank @Size(max = 150) String nombre,
        @Size(min = 1, max = 1000) String descripcion,
        @Size(max = 255) @Schema(format = "uri", pattern = "^https://", maxLength = 255) String imagenUrl) {

    public boolean hasValidImageUri() {
        if (imagenUrl == null) return true;
        try {
            URI uri = URI.create(imagenUrl.trim());
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null;
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }
}
