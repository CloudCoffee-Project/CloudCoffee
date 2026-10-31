package cl.cloudcoffee.catalog_service.dto;

import java.util.UUID;

import cl.cloudcoffee.catalog_service.model.entity.StockReservation;

public record ReserveStockRequest(UUID orderId, UUID offerId, Integer quantity, UUID attemptId) {
    public ReserveStockRequest {
        if (attemptId == null) {
            attemptId = StockReservation.LEGACY_ATTEMPT_ID;
        }
    }

    public ReserveStockRequest(UUID orderId, UUID offerId, Integer quantity) {
        this(orderId, offerId, quantity, null);
    }
}
