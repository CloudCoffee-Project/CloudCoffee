package cl.cloudcoffee.catalog_service.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;

import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.amqp.rabbit.core.RabbitTemplate;

import cl.cloudcoffee.catalog_service.model.entity.Cafeteria;
import cl.cloudcoffee.catalog_service.model.entity.Campus;
import cl.cloudcoffee.catalog_service.model.entity.Offer;
import cl.cloudcoffee.catalog_service.model.entity.Product;

class StockEventPublisherTest {

    private final RabbitTemplate rabbitTemplate = org.mockito.Mockito.mock(RabbitTemplate.class);
    private final StockEventPublisher publisher = new StockEventPublisher(rabbitTemplate);

    @AfterEach
    void clearTraceContext() {
        MDC.clear();
    }

    @Test
    void publishesStockChangeWithTraceIdAndOfferVersion() {
        String traceId = "aabbccddeeff00112233445566778899";
        MDC.put("traceId", traceId);

        UUID offerId = UUID.randomUUID();
        UUID productId = UUID.randomUUID();
        UUID cafeteriaId = UUID.randomUUID();
        UUID campusId = UUID.randomUUID();
        Campus campus = new Campus();
        campus.setId(campusId);
        Cafeteria cafeteria = new Cafeteria();
        cafeteria.setId(cafeteriaId);
        cafeteria.setCampus(campus);
        Product product = new Product();
        product.setId(productId);
        Offer offer = new Offer();
        offer.setId(offerId);
        offer.setProduct(product);
        offer.setCafeteria(cafeteria);
        offer.setStock(7);
        offer.setVersion(3L);

        publisher.publishStockUpdated(offer);

        org.mockito.ArgumentCaptor<CloudCoffeeEvent> eventCaptor =
                org.mockito.ArgumentCaptor.forClass(CloudCoffeeEvent.class);
        verify(rabbitTemplate).convertAndSend(
                eq(RabbitTopologyConfig.EVENTS_EXCHANGE),
                eq(StockEventPublisher.STOCK_UPDATED_EVENT),
                eventCaptor.capture());
        CloudCoffeeEvent event = eventCaptor.getValue();
        assertThat(event.traceId()).isEqualTo(traceId);
        assertThat(event.eventType()).isEqualTo(StockEventPublisher.STOCK_UPDATED_EVENT);
        assertThat(event.payload()).containsEntry("ofertaId", offerId)
                .containsEntry("productoId", productId)
                .containsEntry("cafeteriaId", cafeteriaId)
                .containsEntry("campusId", campusId)
                .containsEntry("stockActual", 7)
                .containsEntry("version", 3L);
    }
}
