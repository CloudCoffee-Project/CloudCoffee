package cl.cloudcoffee.order_service.revision;

import cl.cloudcoffee.order_service.dto.CompraResponse;
import cl.cloudcoffee.order_service.dto.OrdenResponse;
import static cl.cloudcoffee.order_service.persistence.JdbcInstants.utc;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/** Se invoca dentro de la transacción que cambia los recursos y termina el comando. */
@Component
public class EventosRevision {
    private final JdbcTemplate jdbc;
    private final JsonMapper json;
    public EventosRevision(JdbcTemplate jdbc, JsonMapper json) { this.jdbc = jdbc; this.json = json; }

    void orden(OrdenResponse anterior, OrdenResponse actual, UUID cliente, String trace, Instant ahora) {
        var payload = new LinkedHashMap<String, Object>();
        payload.put("compraId", actual.compraId()); payload.put("ordenId", actual.ordenId());
        payload.put("clienteId", cliente); payload.put("cafeteriaId", actual.cafeteriaId());
        payload.put("estadoAnterior", anterior.estado()); payload.put("estado", actual.estado());
        payload.put("version", actual.version());
        guardar("order.orden.estado-cambiado.v1", payload, trace, ahora);
    }
    void compra(CompraResponse anterior, CompraResponse actual, String trace, Instant ahora) {
        guardar("order.compra.estado-cambiado.v1", Map.of("compraId", actual.compraId(), "clienteId", actual.clienteId(),
                "estadoAnterior", anterior.estado(), "estado", actual.estado(), "montoTotal", actual.montoTotal(),
                "moneda", actual.moneda(), "version", actual.version()), trace, ahora);
    }
    private void guardar(String tipo, Map<String, Object> payload, String trace, Instant ahora) {
        UUID id = UUID.randomUUID();
        String cuerpo = json.writeValueAsString(Map.of("eventId", id, "timestamp", ahora, "traceId", trace,
                "eventType", tipo, "payload", payload));
        jdbc.update("INSERT INTO order_outbox (event_id, event_type, cuerpo, created_at) VALUES (?, ?, ?, ?)",
                id, tipo, cuerpo, utc(ahora));
    }
}
