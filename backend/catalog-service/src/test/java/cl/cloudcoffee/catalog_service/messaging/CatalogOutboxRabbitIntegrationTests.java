package cl.cloudcoffee.catalog_service.messaging;

import static org.assertj.core.api.Assertions.*;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import java.net.ServerSocket;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.amqp.rabbit.connection.CachingConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

@EnabledIfEnvironmentVariable(named = "RABBIT_INTEGRATION_TEST", matches = "true")
@SpringBootTest(properties = {"catalog.outbox.publish-enabled=false", "management.tracing.enabled=false"})
class CatalogOutboxRabbitIntegrationTests extends JwtTestSupport {
    @Autowired JdbcTemplate jdbc;
    @Autowired RabbitTemplate rabbit;
    @Autowired CatalogEventJournal journal;
    @Autowired PlatformTransactionManager manager;
    @Autowired JsonMapper json;

    @Test
    void realBrokerConfirmsRoutedMessagesAndRecoversUnavailableOrUnroutableMessages() throws Exception {
        String exchange = "int264.catalog." + UUID.randomUUID();
        String queue = "int264.catalog.queue." + UUID.randomUUID();
        String type = StockEventPublisher.STOCK_UPDATED_EVENT;
        String trace = "0123456789abcdef0123456789abcdef";
        List<UUID> ids = new ArrayList<>();
        rabbit.execute(channel -> {
            channel.exchangeDeclare(exchange, "topic", true);
            channel.queueDeclare(queue, true, false, false, null);
            channel.queueBind(queue, exchange, type);
            return null;
        });
        try {
            jdbc.update("UPDATE catalog_outbox SET publicado=TRUE");
            UUID id = new TransactionTemplate(manager).execute(status -> journal.append(new CloudCoffeeEvent(
                    UUID.randomUUID(), Instant.now(), trace, type, Map.of("ofertaId", UUID.randomUUID(), "stockActual", 3, "version", 1))));
            ids.add(id);
            String original = jdbc.queryForObject("SELECT cuerpo FROM catalog_outbox WHERE event_id=?", String.class, id);
            int unusedPort;
            try (var socket = new ServerSocket(0)) { unusedPort = socket.getLocalPort(); }
            var unavailable = new CachingConnectionFactory("127.0.0.1", unusedPort);
            unavailable.setConnectionTimeout(500);
            try {
                new CatalogEventOutbox(jdbc, new RabbitTemplate(unavailable), manager, exchange).publicar();
                assertThat(published(id)).isFalse();
            } finally { unavailable.destroy(); }
            var restarted = new CatalogEventOutbox(jdbc, rabbit, manager, exchange);
            restarted.publicar();
            assertThat(published(id)).isTrue();
            var received = rabbit.receive(queue, 2000);
            assertThat(received).isNotNull();
            assertThat(new String(received.getBody(), java.nio.charset.StandardCharsets.UTF_8)).isEqualTo(original);
            assertThat(received.getMessageProperties().getMessageId()).isEqualTo(id.toString());
            assertThat(json.readTree(received.getBody()).path("traceId").asString()).isEqualTo(trace);
            restarted.publicar();
            assertThat(rabbit.receive(queue, 100)).isNull();

            String unbound = "catalog.unbound.v1";
            UUID pending = new TransactionTemplate(manager).execute(status -> journal.append(new CloudCoffeeEvent(
                    UUID.randomUUID(), Instant.now(), trace, unbound, Map.of("destinatarios", List.of("customer-1")))));
            ids.add(pending);
            restarted.publicar();
            assertThat(published(pending)).isFalse();
            rabbit.execute(channel -> { channel.queueBind(queue, exchange, unbound); return null; });
            restarted.publicar();
            assertThat(published(pending)).isTrue();
            assertThat(rabbit.receive(queue, 2000).getMessageProperties().getMessageId()).isEqualTo(pending.toString());
        } finally {
            for (UUID id : ids) jdbc.update("DELETE FROM catalog_outbox WHERE event_id=?", id);
            rabbit.execute(channel -> { channel.queueDelete(queue); channel.exchangeDelete(exchange); return null; });
        }
    }

    boolean published(UUID id) { return Boolean.TRUE.equals(jdbc.queryForObject("SELECT publicado FROM catalog_outbox WHERE event_id=?", Boolean.class, id)); }
}
