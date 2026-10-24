package cl.cloudcoffee.catalog_service.dto;

import java.time.Instant;
import java.util.UUID;

import cl.cloudcoffee.catalog_service.model.entity.StockAdjustment;

public record StockAdjustmentResponse(
        UUID adjustmentId, UUID offerId, int quantity, long reservedQuantity,
        int previousStock, int stock, long version, Instant adjustedAt) {

    public static StockAdjustmentResponse from(StockAdjustment adjustment) {
        return new StockAdjustmentResponse(adjustment.getId(), adjustment.getOffer().getId(),
                adjustment.getQuantity(), adjustment.getReservedQuantity(), adjustment.getPreviousStock(),
                adjustment.getStock(), adjustment.getVersion(), adjustment.getAdjustedAt());
    }
}
