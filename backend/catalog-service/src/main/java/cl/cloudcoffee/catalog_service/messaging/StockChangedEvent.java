package cl.cloudcoffee.catalog_service.messaging;

import java.time.Instant;
import java.util.UUID;

public record StockChangedEvent(UUID eventId, Instant timestamp, String traceId, UUID offerId,
        UUID productId, UUID cafeteriaId, UUID campusId, int stock, long version) {
}
