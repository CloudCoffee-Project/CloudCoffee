package cl.cloudcoffee.catalog_service.dto;

import java.util.UUID;
import cl.cloudcoffee.catalog_service.model.entity.Product;

public record ProductResponse(
        UUID id,
        UUID categoriaId,
        String nombre,
        String descripcion,
        String imagenUrl,
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
