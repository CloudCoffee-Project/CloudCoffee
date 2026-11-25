package cl.cloudcoffee.catalog_service.dto;

import java.util.UUID;

import cl.cloudcoffee.catalog_service.model.entity.Product;
import cl.cloudcoffee.catalog_service.model.enums.ProductStatus;

public record ProductAdminResponse(UUID productoId, UUID categoriaId, String nombre, String descripcion,
        String imagenUrl, boolean activo, long version) {
    public static ProductAdminResponse from(Product product) {
        return new ProductAdminResponse(product.getId(), product.getCategory().getId(), product.getName(),
                product.getDescription(), product.getImageUrl(), product.getStatus() == ProductStatus.ACTIVE,
                product.getVersion());
    }
}
