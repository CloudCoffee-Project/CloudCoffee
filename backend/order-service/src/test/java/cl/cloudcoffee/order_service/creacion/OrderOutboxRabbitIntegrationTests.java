package cl.cloudcoffee.order_service.creacion;

import static org.assertj.core.api.Assertions.*;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import tools.jackson.databind.json.JsonMapper;

@EnabledIfEnvironmentVariable(named = "RABBIT_INTEGRATION_TEST", matches = "true")
@SpringBootTest(properties = {"cloudcoffee.creation.recovery-enabled=false", "cloudcoffee.creation.publish-enabled=false",
        "management.tracing.enabled=false"})
class OrderOutboxRabbitIntegrationTests extends JwtTestSupport {
    @Autowired JdbcTemplate jdbc;
    @Autowired RabbitTemplate rabbit;
    @Autowired PlatformTransactionManager manager;
    @Autowired JsonMapper json;

    @Test void brokerRealConfirmaEntregaYRetornoSinRutaPermanecePendiente() throws Exception {
        UUID eventId = UUID.randomUUID();
        String queue = "int271." + UUID.randomUUID();
        String routing = "order.compra.creada.v1";
        rabbit.execute(channel -> {
            channel.exchangeDeclare("cloudcoffee.events", "topic", true);
            channel.queueDeclare(queue, false, false, false, null);
            channel.queueBind(queue, "cloudcoffee.events", routing);
            return null;
        });
        try {
            jdbc.update("UPDATE order_outbox SET publicado=TRUE");
            var envelope = Map.of("eventId", eventId, "timestamp", Instant.now(), "traceId", "12345678901234567890123456789012",
                    "eventType", routing, "payload", Map.of("compraId", UUID.randomUUID()));
            jdbc.update("INSERT INTO order_outbox (event_id, event_type, cuerpo, created_at) VALUES (?, ?, ?, ?)",
                    eventId, routing, json.writeValueAsString(envelope), Timestamp.from(Instant.now()));
            var publisher = new OrderEventOutbox(jdbc, rabbit, manager);
            publisher.publicar();
            assertThat(jdbc.queryForObject("SELECT publicado FROM order_outbox WHERE event_id=?", Boolean.class, eventId)).isTrue();
            var message = rabbit.receive(queue, 2000);
            assertThat(message).isNotNull();
            assertThat(json.readTree(message.getBody()).path("eventId").asString()).isEqualTo(eventId.toString());
            publisher.publicar();
            assertThat(rabbit.receive(queue, 100)).isNull();

            UUID sinRuta = UUID.randomUUID();
            jdbc.update("INSERT INTO order_outbox (event_id, event_type, cuerpo, created_at) VALUES (?, ?, ?, ?)",
                    sinRuta, "sin.binding." + sinRuta, "{}", Timestamp.from(Instant.now()));
            publisher.publicar();
            assertThat(jdbc.queryForObject("SELECT publicado FROM order_outbox WHERE event_id=?", Boolean.class, sinRuta)).isFalse();
            jdbc.update("DELETE FROM order_outbox WHERE event_id=?", sinRuta);
        } finally {
            rabbit.execute(channel -> { channel.queueDelete(queue); return null; });
        }
    }
}
