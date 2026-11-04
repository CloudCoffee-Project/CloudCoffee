package cl.cloudcoffee.catalog_service.messaging;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import org.slf4j.MDC;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;

import cl.cloudcoffee.catalog_service.model.entity.Offer;

@Component
public class StockEventPublisher {

    public static final String STOCK_UPDATED_EVENT = "catalog.stock.actualizado.v1";

    private final RabbitTemplate rabbitTemplate;

    public StockEventPublisher(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    public void publishStockUpdated(Offer offer) {
        String traceId = MDC.get("traceId");
        if (traceId == null || traceId.isBlank()) {
            traceId = UUID.randomUUID().toString().replace("-", "");
        }

        CloudCoffeeEvent event = new CloudCoffeeEvent(
                UUID.randomUUID(),
                Instant.now(),
                traceId,
                STOCK_UPDATED_EVENT,
                Map.of(
                        "ofertaId", offer.getId(),
                        "productoId", offer.getProduct().getId(),
                        "cafeteriaId", offer.getCafeteria().getId(),
                        "campusId", offer.getCafeteria().getCampus().getId(),
                        "stockActual", offer.getStock(),
                        "version", offer.getVersion()));

        rabbitTemplate.convertAndSend(
                RabbitTopologyConfig.EVENTS_EXCHANGE,
                STOCK_UPDATED_EVENT,
                event);
    }
}
