package cl.cloudcoffee.catalog_service.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.UUID;
import cl.cloudcoffee.catalog_service.model.entity.Product;

public record ProductResponse(
        @Schema(description = "Identificador UUID", example = "11111111-1111-4111-8111-111111111111")
        UUID id,
        @Schema(description = "UUID de categoría", example = "22222222-2222-4222-8222-222222222222")
        UUID categoriaId,
        @Schema(description = "Nombre", example = "Café americano")
        String nombre,
        @Schema(description = "Descripción del producto", example = "Café recién preparado")
        String descripcion,
        @Schema(description = "URL de imagen del producto", example = "https://example.com/cafe.png")
        String imagenUrl,
        @Schema(description = "Estado del producto", example = "ACTIVE")
        String estado
) {
    public static ProductResponse from(Product product) {
        return new ProductResponse(
                product.getId(),
                product.getCategory().getId(),
                product.getName(),
                product.getDescription(),
                product.getImageUrl(),
                product.getStatus().name()
        );
    }
}
