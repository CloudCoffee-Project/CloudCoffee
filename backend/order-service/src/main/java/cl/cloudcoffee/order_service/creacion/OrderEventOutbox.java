package cl.cloudcoffee.order_service.creacion;

import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Publicación al menos una vez: solo marcar enviado tras confirmación y sin devolución del broker. */
@Configuration
@ConditionalOnProperty(name = "cloudcoffee.creation.publish-enabled", havingValue = "true", matchIfMissing = true)
public class OrderEventOutbox {
    private static final Logger LOG = LoggerFactory.getLogger(OrderEventOutbox.class);
    private final JdbcTemplate jdbc;
    private final RabbitTemplate rabbit;
    private final TransactionTemplate tx;
    public OrderEventOutbox(JdbcTemplate jdbc, RabbitTemplate rabbit, PlatformTransactionManager manager) {
        this.jdbc = jdbc; this.rabbit = rabbit; this.tx = new TransactionTemplate(manager);
    }
    @Bean
    TopicExchange orderEventsExchange() { return new TopicExchange("cloudcoffee.events", true, false); }

    @Scheduled(fixedDelayString = "${cloudcoffee.creation.publish-ms:2000}", initialDelayString = "${cloudcoffee.creation.publish-ms:2000}")
    public void publicar() {
        try {
            for (int i = 0; i < 20; i++) {
                Boolean enviado = tx.execute(status -> {
                    var eventos = jdbc.query("""
                            SELECT event_id, event_type, cuerpo FROM order_outbox WHERE publicado=FALSE
                            ORDER BY created_at, event_id LIMIT 1 FOR UPDATE SKIP LOCKED
                            """, (rs, n) -> new Evento(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3)));
                    if (eventos.isEmpty()) return false;
                    Evento evento = eventos.getFirst();
                    var message = MessageBuilder.withBody(evento.cuerpo().getBytes(java.nio.charset.StandardCharsets.UTF_8))
                            .setContentType(MessageProperties.CONTENT_TYPE_JSON).setContentEncoding("UTF-8")
                            .setDeliveryMode(MessageDeliveryMode.PERSISTENT).setMessageId(evento.id().toString()).build();
                    var correlation = new CorrelationData(evento.id().toString());
                    rabbit.send("cloudcoffee.events", evento.tipo(), message, correlation);
                    try {
                        if (!correlation.getFuture().get(2, TimeUnit.SECONDS).ack() || correlation.getReturned() != null)
                            throw new IllegalStateException("Broker no confirmó la entrega del evento");
                    } catch (InterruptedException interrupted) {
                        Thread.currentThread().interrupt(); throw new IllegalStateException("Publicación interrumpida", interrupted);
                    } catch (java.util.concurrent.ExecutionException | java.util.concurrent.TimeoutException error) {
                        throw new IllegalStateException("Sin confirmación del broker", error);
                    }
                    jdbc.update("UPDATE order_outbox SET publicado=TRUE WHERE event_id=?", evento.id());
                    return true;
                });
                if (!Boolean.TRUE.equals(enviado)) break;
            }
        } catch (RuntimeException error) { LOG.warn("Los eventos pendientes se reintentarán: {}", error.getClass().getSimpleName()); }
    }
    private record Evento(UUID id, String tipo, String cuerpo) {}
}
