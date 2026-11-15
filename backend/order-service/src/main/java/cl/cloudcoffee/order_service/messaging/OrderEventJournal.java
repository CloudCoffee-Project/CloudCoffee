package cl.cloudcoffee.order_service.messaging;

import static cl.cloudcoffee.order_service.persistence.JdbcInstants.utc;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** One append point for creation, review, payment and future pickup transitions. Uses the existing outbox. */
@Component
public class OrderEventJournal {
    private final JdbcTemplate jdbc;
    private final JsonMapper json;

    public OrderEventJournal(JdbcTemplate jdbc, JsonMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public UUID append(String type, Map<String, Object> payload, String trace, Instant occurredAt) {
        if (type == null || type.isBlank() || trace == null || trace.isBlank()) {
            throw new IllegalArgumentException("Order events require eventType and traceId");
        }
        UUID id = UUID.randomUUID();
        String body = json.writeValueAsString(Map.of("eventId", id, "eventType", type,
                "timestamp", occurredAt, "traceId", trace, "payload", payload));
        jdbc.update("INSERT INTO order_outbox (event_id, event_type, cuerpo, created_at) VALUES (?, ?, ?, ?)",
                id, type, body, utc(occurredAt));
        return id;
    }
}
