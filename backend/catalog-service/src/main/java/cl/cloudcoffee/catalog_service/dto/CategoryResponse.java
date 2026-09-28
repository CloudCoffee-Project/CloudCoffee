package cl.cloudcoffee.catalog_service.dto;

import java.util.UUID;

import cl.cloudcoffee.catalog_service.model.entity.Category;

public record CategoryResponse(
        UUID id,
        String nombre
) {

    public static CategoryResponse from(Category category) {
        return new CategoryResponse(category.getId(), category.getName());
    }
}
