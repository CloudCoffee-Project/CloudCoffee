package cl.cloudcoffee.order_service.messaging;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/** Sobre común de los eventos de CloudCoffee (mismo formato que auth y notification). */
public record CloudCoffeeEvent(
        UUID eventId,
        Instant timestamp,
        String traceId,
        String eventType,
        Map<String, Object> payload
) {
}
