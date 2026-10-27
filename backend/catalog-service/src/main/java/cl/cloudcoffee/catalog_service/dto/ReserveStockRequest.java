package cl.cloudcoffee.catalog_service.dto;

import java.util.UUID;

public record ReserveStockRequest(UUID orderId, UUID offerId, Integer quantity) {
}
