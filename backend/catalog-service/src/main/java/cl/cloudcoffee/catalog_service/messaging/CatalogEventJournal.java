package cl.cloudcoffee.catalog_service.messaging;

import java.time.ZoneOffset;
import java.util.Objects;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Shared append point for stock and future targeted Catalog events, inside the business transaction. */
@Component
public class CatalogEventJournal {
    private final JdbcTemplate jdbc;
    private final JsonMapper json;

    public CatalogEventJournal(JdbcTemplate jdbc, JsonMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public UUID append(CloudCoffeeEvent event) {
        Objects.requireNonNull(event.eventId(), "eventId");
        if (event.eventType() == null || event.eventType().isBlank()
                || event.traceId() == null || event.traceId().isBlank()) {
            throw new IllegalArgumentException("Catalog events require eventType and traceId");
        }
        jdbc.update("INSERT INTO catalog_outbox (event_id, event_type, cuerpo, created_at) VALUES (?, ?, ?, ?)",
                event.eventId(), event.eventType(), json.writeValueAsString(event),
                event.timestamp().atOffset(ZoneOffset.UTC));
        return event.eventId();
    }
}
