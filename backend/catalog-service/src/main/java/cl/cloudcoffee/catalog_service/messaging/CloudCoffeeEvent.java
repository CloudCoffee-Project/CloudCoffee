package cl.cloudcoffee.catalog_service.messaging;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/** Sobre común de los eventos de CloudCoffee (mismo formato que los demás servicios). */
public record CloudCoffeeEvent(
        UUID eventId,
        Instant timestamp,
        String traceId,
        String eventType,
        Map<String, Object> payload
) {
}
