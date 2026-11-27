package cl.cloudcoffee.catalog_service.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import cl.cloudcoffee.catalog_service.model.entity.Offer;

public record CafeteriaInventoryItemResponse(
        @Schema(description = "UUID de la oferta", example = "55555555-5555-4555-8555-555555555501")
        UUID id,
        @Schema(description = "UUID del producto", example = "33333333-3333-4333-8333-333333333333")
        UUID productoId,
        @Schema(description = "Nombre del producto", example = "Café americano")
        String productoNombre,
        @Schema(description = "Precio de la oferta", example = "1500.00")
        BigDecimal precio,
        @Schema(description = "Unidades en stock", example = "40")
        Integer stock,
        @Schema(description = "Estado de la oferta", example = "AVAILABLE")
        String estado,
        @Schema(description = "Indica si la cafetería mantiene activa administrativamente la oferta", example = "true")
        Boolean activa,
        @Schema(description = "Momento de baja lógica, si aplica")
        Instant bajaAt,
        @Schema(description = "Versión optimista de la oferta", example = "4")
        Long version
) {
    public static CafeteriaInventoryItemResponse from(Offer offer) {
        return new CafeteriaInventoryItemResponse(
                offer.getId(),
                offer.getProduct().getId(),
                offer.getProduct().getName(),
                offer.getPrice(),
                offer.getStock(),
                offer.getStatus().name(),
                offer.isAdministrativeActive(),
                offer.getBajaAt(),
                offer.getVersion()
        );
    }
}
