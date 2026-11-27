package cl.cloudcoffee.catalog_service.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;

import cl.cloudcoffee.catalog_service.model.entity.Cafeteria;
import cl.cloudcoffee.catalog_service.model.entity.Campus;
import cl.cloudcoffee.catalog_service.model.entity.Offer;
import cl.cloudcoffee.catalog_service.model.entity.Product;
import cl.cloudcoffee.catalog_service.model.entity.ProductFollow;
import cl.cloudcoffee.catalog_service.repository.ProductFollowRepository;

class StockEventPublisherTest {

    private final CatalogEventJournal journal = org.mockito.Mockito.mock(CatalogEventJournal.class);
    private final ProductFollowRepository followRepository = org.mockito.Mockito.mock(ProductFollowRepository.class);
    private final StockEventPublisher publisher = new StockEventPublisher(journal, followRepository);

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
        verify(journal).append(eventCaptor.capture());
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

    @Test
    void publishesRestockOnlyForZeroToPositiveWithActiveRecipientsAndNames() {
        String traceId = "aabbccddeeff00112233445566778899";
        MDC.put("traceId", traceId);
        UUID offerId = UUID.randomUUID();
        UUID productId = UUID.randomUUID();
        UUID cafeteriaId = UUID.randomUUID();
        UUID campusId = UUID.randomUUID();
        UUID followerId = UUID.randomUUID();
        Campus campus = new Campus();
        campus.setId(campusId);
        campus.setName("Campus central");
        Cafeteria cafeteria = new Cafeteria();
        cafeteria.setId(cafeteriaId);
        cafeteria.setName("Cafetería norte");
        cafeteria.setCampus(campus);
        Product product = new Product();
        product.setId(productId);
        product.setName("Café americano");
        Offer offer = new Offer();
        offer.setId(offerId);
        offer.setProduct(product);
        offer.setCafeteria(cafeteria);
        offer.setStock(5);
        offer.setVersion(4L);
        when(followRepository.findActiveRecipientIdsForRestockedOffer(
                productId, cafeteriaId, ProductFollow.GENERAL)).thenReturn(List.of(followerId));

        publisher.publishProductAvailableIfRestocked(offer, 0);

        org.mockito.ArgumentCaptor<CloudCoffeeEvent> eventCaptor =
                org.mockito.ArgumentCaptor.forClass(CloudCoffeeEvent.class);
        verify(journal).append(eventCaptor.capture());
        CloudCoffeeEvent event = eventCaptor.getValue();
        assertThat(event.eventId()).isNotNull();
        assertThat(event.traceId()).isEqualTo(traceId);
        assertThat(event.eventType()).isEqualTo(StockEventPublisher.PRODUCT_AVAILABLE_EVENT);
        assertThat(event.payload()).containsEntry("productoId", productId)
                .containsEntry("productoNombre", "Café americano")
                .containsEntry("cafeteriaId", cafeteriaId)
                .containsEntry("cafeteriaNombre", "Cafetería norte")
                .containsEntry("campusId", campusId)
                .containsEntry("campusNombre", "Campus central")
                .containsEntry("destinatarios", List.of(followerId.toString()));
    }

    @Test
    void doesNotPublishRestockForPositiveStockOrWithoutFollowers() {
        Offer offer = new Offer();
        offer.setStock(5);

        publisher.publishProductAvailableIfRestocked(offer, 1);
        verifyNoInteractions(followRepository, journal);

        Campus campus = new Campus();
        campus.setId(UUID.randomUUID());
        Cafeteria cafeteria = new Cafeteria();
        cafeteria.setId(UUID.randomUUID());
        cafeteria.setCampus(campus);
        Product product = new Product();
        product.setId(UUID.randomUUID());
        offer.setStock(5);
        offer.setProduct(product);
        offer.setCafeteria(cafeteria);
        when(followRepository.findActiveRecipientIdsForRestockedOffer(any(), any(), any()))
                .thenReturn(List.of());
        publisher.publishProductAvailableIfRestocked(offer, 0);

        verify(followRepository).findActiveRecipientIdsForRestockedOffer(any(), any(), any());
        verifyNoInteractions(journal);
    }
}
