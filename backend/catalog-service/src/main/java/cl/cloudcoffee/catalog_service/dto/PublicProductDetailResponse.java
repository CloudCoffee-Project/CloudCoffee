package cl.cloudcoffee.catalog_service.dto;

import java.util.UUID;

import io.swagger.v3.oas.annotations.media.Schema;
import cl.cloudcoffee.catalog_service.model.entity.Product;

@Schema(description = "Detalle público de un producto activo")
public record PublicProductDetailResponse(
        @Schema(description = "Identificador UUID", example = "33333333-3333-4333-8333-333333333333")
        UUID id,
        @Schema(description = "Nombre del producto", example = "Café americano")
        String nombre,
        @Schema(description = "Descripción del producto", example = "Café recién preparado")
        String descripcion,
        @Schema(description = "URL de imagen del producto", example = "https://example.com/cafe.png")
        String imagenUrl,
        @Schema(description = "Categoría pública del producto")
        CategoryResponse categoria
) {
    public static PublicProductDetailResponse from(Product product) {
        return new PublicProductDetailResponse(
                product.getId(),
                product.getName(),
                product.getDescription(),
                product.getImageUrl(),
                CategoryResponse.from(product.getCategory())
        );
    }
}
