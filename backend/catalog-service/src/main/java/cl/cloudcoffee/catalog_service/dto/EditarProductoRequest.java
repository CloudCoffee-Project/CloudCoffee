package cl.cloudcoffee.catalog_service.dto;

import java.net.URI;
import java.util.UUID;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

public record EditarProductoRequest(
        UUID categoriaId,
        @Size(min = 1, max = 150) String nombre,
        @Size(min = 1, max = 1000) String descripcion,
        @Size(max = 255) @Schema(format = "uri", pattern = "^https://", maxLength = 255) String imagenUrl,
        @Min(1) long version) {

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
