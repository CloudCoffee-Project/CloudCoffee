package cl.cloudcoffee.catalog_service.dto;

import java.time.Instant;
import java.util.UUID;

import cl.cloudcoffee.catalog_service.model.entity.ProductFollow;
import io.swagger.v3.oas.annotations.media.Schema;

/** Forma que ya consume la app (mobile/src/types/domain.ts, Seguimiento) más la fecha de alta. */
public record SeguimientoResponse(
        @Schema(description = "UUID del seguimiento", example = "88888888-8888-4888-8888-888888888801")
        UUID id,
        @Schema(description = "UUID del producto seguido", example = "33333333-3333-4333-8333-333333333333")
        UUID productoId,
        @Schema(description = "Nombre del producto", example = "Café americano")
        String productoNombre,
        @Schema(description = "UUID de la cafetería; null si el seguimiento es general (cualquier cafetería)",
                example = "44444444-4444-4444-8444-444444444444", nullable = true)
        UUID cafeteriaId,
        @Schema(description = "Nombre de la cafetería; null si el seguimiento es general",
                example = "Cafetería Central", nullable = true)
        String cafeteriaNombre,
        @Schema(description = "Fecha de alta, o de reactivación si se volvió a seguir", example = "2026-11-13T15:00:00Z")
        Instant creadoAt
) {
    public static SeguimientoResponse from(ProductFollow follow) {
        var cafeteria = follow.getCafeteria();
        return new SeguimientoResponse(follow.getId(), follow.getProduct().getId(), follow.getProduct().getName(),
                cafeteria == null ? null : cafeteria.getId(), cafeteria == null ? null : cafeteria.getName(),
                follow.getCreatedAt());
    }
}
