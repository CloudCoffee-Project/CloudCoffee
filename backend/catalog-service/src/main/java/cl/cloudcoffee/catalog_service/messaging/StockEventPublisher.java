package cl.cloudcoffee.catalog_service.messaging;

import java.util.Map;

import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

@Component
public class StockEventPublisher {
    public static final String EVENT_TYPE = "catalog.stock.actualizado.v1";
    private final RabbitTemplate rabbitTemplate;

    public StockEventPublisher(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void publish(StockChangedEvent event) {
        rabbitTemplate.convertAndSend(RabbitTopologyConfig.EVENTS_EXCHANGE, EVENT_TYPE, Map.of(
                "eventId", event.eventId(), "timestamp", event.timestamp(), "traceId", event.traceId(),
                "eventType", EVENT_TYPE, "payload", Map.of(
                        "ofertaId", event.offerId(), "productoId", event.productId(),
                        "cafeteriaId", event.cafeteriaId(), "campusId", event.campusId(),
                        "stockActual", event.stock(), "version", event.version())));
    }
}
