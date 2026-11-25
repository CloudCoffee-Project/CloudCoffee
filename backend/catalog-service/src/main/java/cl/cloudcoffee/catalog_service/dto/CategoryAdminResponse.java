package cl.cloudcoffee.catalog_service.dto;

import java.util.UUID;

import cl.cloudcoffee.catalog_service.model.entity.Category;

public record CategoryAdminResponse(UUID categoriaId, String nombre, String descripcion, boolean activa, long version) {
    public static CategoryAdminResponse from(Category category) {
        return new CategoryAdminResponse(category.getId(), category.getName(), category.getDescription(),
                category.isActive(), category.getVersion());
    }
}
