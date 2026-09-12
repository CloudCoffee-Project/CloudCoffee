package cl.cloudcoffee.notification_service.messaging;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record CloudCoffeeEvent(
        UUID eventId,
        Instant timestamp,
        String traceId,
        String eventType,
        Map<String, Object> payload
) {
}