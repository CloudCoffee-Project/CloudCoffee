package cl.cloudcoffee.catalog_service.dto;

import java.util.UUID;
import java.time.Instant;
import java.math.BigDecimal;

import cl.cloudcoffee.catalog_service.model.entity.StockReservation;

public record ReserveStockRequest(UUID orderId, UUID offerId, Integer quantity, UUID attemptId,
        Instant expiresAt, BigDecimal expectedPrice) {
    public ReserveStockRequest {
        if (attemptId == null) {
            attemptId = StockReservation.LEGACY_ATTEMPT_ID;
        }
    }

    public ReserveStockRequest(UUID orderId, UUID offerId, Integer quantity) {
        this(orderId, offerId, quantity, null, null, null);
    }

    public ReserveStockRequest(UUID orderId, UUID offerId, Integer quantity, UUID attemptId) {
        this(orderId, offerId, quantity, attemptId, null, null);
    }
}
