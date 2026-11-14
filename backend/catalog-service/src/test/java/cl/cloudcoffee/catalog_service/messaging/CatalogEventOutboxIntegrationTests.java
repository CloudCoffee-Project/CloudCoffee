package cl.cloudcoffee.catalog_service.messaging;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import cl.cloudcoffee.security.testing.JwtTestSupport;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.*;
import org.springframework.amqp.AmqpConnectException;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.ReturnedMessage;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

@org.springframework.test.annotation.DirtiesContext(classMode = org.springframework.test.annotation.DirtiesContext.ClassMode.AFTER_CLASS)
@SpringBootTest(properties = {"catalog.outbox.publish-enabled=false", "cloudcoffee.creation.recovery-enabled=false",
        "catalog.reservations.expiration-scan-ms=3600000", "management.tracing.enabled=false"})
class CatalogEventOutboxIntegrationTests extends JwtTestSupport {
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager manager;
    @Autowired CatalogEventJournal journal;
    @Autowired JsonMapper json;
    final List<UUID> ids = new ArrayList<>();
    final String trace = "0123456789abcdef0123456789abcdef";
    final Instant occurredAt = Instant.parse("2026-11-14T12:00:00Z");
    TransactionTemplate tx;

    @BeforeEach
    void prepare() {
        tx = new TransactionTemplate(manager);
        // Other integration suites may leave their own historical rows in PostgreSQL.
        jdbc.update("UPDATE catalog_outbox SET publicado=TRUE");
    }

    @AfterEach
    void removeOwnEvents() {
        for (UUID id : ids) jdbc.update("DELETE FROM catalog_outbox WHERE event_id=?", id);
    }

    @Test
    void journalCannotCommitOutsideTheBusinessTransaction() {
        assertThatThrownBy(this::append).isInstanceOf(IllegalTransactionStateException.class);
    }

    @Test
    void aRollbackLeavesNoEventAndAPublisherCannotSeeUncommittedRows() {
        RabbitTemplate rabbit = mock(RabbitTemplate.class);
        var publisher = new CatalogEventOutbox(jdbc, rabbit, manager);
        assertThatThrownBy(() -> tx.executeWithoutResult(status -> {
            UUID id = append();
            ids.add(id);
            publisher.publicar();
            verifyNoInteractions(rabbit);
            throw new IllegalStateException("rollback after mutation and append");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM catalog_outbox WHERE event_id=?", Integer.class, ids.getFirst())).isZero();
    }

    @Test
    void brokerFailureAndRestartResendTheOriginalEnvelope() throws Exception {
        UUID id = committed();
        String original = body(id);
        RabbitTemplate rabbit = mock(RabbitTemplate.class);
        doThrow(new AmqpConnectException(new java.net.ConnectException("broker unavailable")))
                .when(rabbit).send(anyString(), anyString(), any(Message.class), any(CorrelationData.class));
        new CatalogEventOutbox(jdbc, rabbit, manager).publicar();
        assertThat(published(id)).isFalse();
        assertThat(body(id)).isEqualTo(original);
        acknowledge(rabbit);
        // New instance, same database: publication must not reconstruct the event.
        new CatalogEventOutbox(jdbc, rabbit, manager).publicar();
        assertThat(published(id)).isTrue();
        var sent = org.mockito.ArgumentCaptor.forClass(Message.class);
        verify(rabbit, times(2)).send(anyString(), anyString(), sent.capture(), any(CorrelationData.class));
        assertThat(sent.getAllValues()).allSatisfy(message -> {
            assertThat(new String(message.getBody(), java.nio.charset.StandardCharsets.UTF_8)).isEqualTo(original);
            assertThat(message.getMessageProperties().getMessageId()).isEqualTo(id.toString());
            assertThat(message.getMessageProperties().getDeliveryMode()).isEqualTo(org.springframework.amqp.core.MessageDeliveryMode.PERSISTENT);
        });
        assertThat(json.readTree(original).path("traceId").asString()).isEqualTo(trace);
        assertThat(json.readTree(original).path("timestamp").asString()).isEqualTo(occurredAt.toString());
    }

    @Test
    void lostConfirmationMayRedeliverButNeverCreatesANewEventIdentity() throws Exception {
        UUID id = committed();
        String original = body(id);
        List<Message> acceptedByBroker = new ArrayList<>();
        RabbitTemplate rabbit = mock(RabbitTemplate.class);
        doAnswer(call -> { acceptedByBroker.add(call.getArgument(2)); return null; })
                .when(rabbit).send(anyString(), anyString(), any(Message.class), any(CorrelationData.class));
        new CatalogEventOutbox(jdbc, rabbit, manager).publicar();
        assertThat(published(id)).isFalse();
        doAnswer(call -> {
            acceptedByBroker.add(call.getArgument(2));
            call.getArgument(3, CorrelationData.class).getFuture().complete(new CorrelationData.Confirm(true, null));
            return null;
        }).when(rabbit).send(anyString(), anyString(), any(Message.class), any(CorrelationData.class));
        new CatalogEventOutbox(jdbc, rabbit, manager).publicar();
        assertThat(published(id)).isTrue();
        assertThat(acceptedByBroker).hasSize(2).allSatisfy(message ->
                assertThat(new String(message.getBody(), java.nio.charset.StandardCharsets.UTF_8)).isEqualTo(original));
    }

    @Test
    void nackAndMandatoryReturnRemainPendingUntilABrokerConfirmsARoutedMessage() {
        UUID id = committed();
        RabbitTemplate rabbit = mock(RabbitTemplate.class);
        doAnswer(call -> {
            call.getArgument(3, CorrelationData.class).getFuture().complete(new CorrelationData.Confirm(false, "nack"));
            return null;
        }).when(rabbit).send(anyString(), anyString(), any(Message.class), any(CorrelationData.class));
        new CatalogEventOutbox(jdbc, rabbit, manager).publicar();
        assertThat(published(id)).isFalse();
        doAnswer(call -> {
            var correlation = call.getArgument(3, CorrelationData.class);
            correlation.setReturned(new ReturnedMessage(call.getArgument(2), 312, "NO_ROUTE", "cloudcoffee.events", "missing"));
            correlation.getFuture().complete(new CorrelationData.Confirm(true, null));
            return null;
        }).when(rabbit).send(anyString(), anyString(), any(Message.class), any(CorrelationData.class));
        new CatalogEventOutbox(jdbc, rabbit, manager).publicar();
        assertThat(published(id)).isFalse();
        acknowledge(rabbit);
        new CatalogEventOutbox(jdbc, rabbit, manager).publicar();
        assertThat(published(id)).isTrue();
    }

    @Test
    void failureAfterBrokerAcceptanceBeforeDatabaseMarkIsRecovered() {
        UUID id = committed();
        RabbitTemplate rabbit = mock(RabbitTemplate.class);
        doAnswer(call -> {
            call.getArgument(3, CorrelationData.class).getFuture().complete(new CorrelationData.Confirm(true, null));
            throw new IllegalStateException("process failed after broker acceptance");
        }).when(rabbit).send(anyString(), anyString(), any(Message.class), any(CorrelationData.class));
        new CatalogEventOutbox(jdbc, rabbit, manager).publicar();
        assertThat(published(id)).isFalse();
        acknowledge(rabbit);
        new CatalogEventOutbox(jdbc, rabbit, manager).publicar();
        assertThat(published(id)).isTrue();
        verify(rabbit, times(2)).send(anyString(), anyString(), any(Message.class), any(CorrelationData.class));
    }

    @Test
    void twoReplicasSkipTheInFlightRowAndPublishEachCommittedEventOnce() throws Exception {
        UUID first = committed(), second = committed();
        var firstSendEntered = new CountDownLatch(1);
        var releaseFirstSend = new CountDownLatch(1);
        var firstSend = new AtomicBoolean(true);
        List<String> delivered = Collections.synchronizedList(new ArrayList<>());
        RabbitTemplate rabbit = mock(RabbitTemplate.class);
        doAnswer(call -> {
            var correlation = call.getArgument(3, CorrelationData.class);
            if (firstSend.compareAndSet(true, false)) {
                firstSendEntered.countDown();
                if (!releaseFirstSend.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("test synchronization timeout");
            }
            delivered.add(correlation.getId());
            correlation.getFuture().complete(new CorrelationData.Confirm(true, null));
            return null;
        }).when(rabbit).send(anyString(), anyString(), any(Message.class), any(CorrelationData.class));
        try (var workers = Executors.newFixedThreadPool(2)) {
            var one = workers.submit(() -> new CatalogEventOutbox(jdbc, rabbit, manager).publicar());
            try {
                assertThat(firstSendEntered.await(5, TimeUnit.SECONDS)).isTrue();
                var two = workers.submit(() -> new CatalogEventOutbox(jdbc, rabbit, manager).publicar());
                two.get(5, TimeUnit.SECONDS);
                // PostgreSQL scans past the locked row. H2 may apply LIMIT before SKIP LOCKED;
                // either way, the second worker must return without publishing the locked event.
                String database = jdbc.execute((org.springframework.jdbc.core.ConnectionCallback<String>)
                        connection -> connection.getMetaData().getDatabaseProductName());
                if ("PostgreSQL".equals(database)) assertThat(delivered).hasSize(1);
                else assertThat(delivered).hasSizeLessThanOrEqualTo(1);
            } finally { releaseFirstSend.countDown(); }
            one.get(5, TimeUnit.SECONDS);
        }
        assertThat(delivered).containsExactlyInAnyOrder(first.toString(), second.toString());
        assertThat(published(first)).isTrue();
        assertThat(published(second)).isTrue();
    }

    UUID committed() {
        UUID id = tx.execute(status -> append());
        ids.add(id);
        return id;
    }

    UUID append() { return journal.append(new CloudCoffeeEvent(UUID.randomUUID(), occurredAt, trace, "catalog.producto.disponible.v1", Map.of("destinatarios", List.of("customer-1"), "version", 1))); }
    String body(UUID id) { return jdbc.queryForObject("SELECT cuerpo FROM catalog_outbox WHERE event_id=?", String.class, id); }
    boolean published(UUID id) { return Boolean.TRUE.equals(jdbc.queryForObject("SELECT publicado FROM catalog_outbox WHERE event_id=?", Boolean.class, id)); }
    void acknowledge(RabbitTemplate rabbit) {
        doAnswer(call -> {
            call.getArgument(3, CorrelationData.class).getFuture().complete(new CorrelationData.Confirm(true, null));
            return null;
        }).when(rabbit).send(anyString(), anyString(), any(Message.class), any(CorrelationData.class));
    }
}
