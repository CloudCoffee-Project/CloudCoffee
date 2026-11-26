package cl.cloudcoffee.catalog_service.messaging;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.slf4j.MDC;
import org.springframework.stereotype.Component;

import cl.cloudcoffee.catalog_service.model.entity.Offer;
import cl.cloudcoffee.catalog_service.model.entity.ProductFollow;
import cl.cloudcoffee.catalog_service.repository.ProductFollowRepository;

@Component
public class StockEventPublisher {

    public static final String STOCK_UPDATED_EVENT = "catalog.stock.actualizado.v1";
    public static final String PRODUCT_AVAILABLE_EVENT = "catalog.producto.disponible.v1";

    private final CatalogEventJournal journal;
    private final ProductFollowRepository followRepository;

    public StockEventPublisher(CatalogEventJournal journal, ProductFollowRepository followRepository) {
        this.journal = journal;
        this.followRepository = followRepository;
    }

    public void publishStockUpdated(Offer offer) {
        journal.append(new CloudCoffeeEvent(
                UUID.randomUUID(),
                Instant.now(),
                traceId(),
                STOCK_UPDATED_EVENT,
                Map.of(
                        "ofertaId", offer.getId(),
                        "productoId", offer.getProduct().getId(),
                        "cafeteriaId", offer.getCafeteria().getId(),
                        "campusId", offer.getCafeteria().getCampus().getId(),
                        "stockActual", offer.getStock(),
                        "version", offer.getVersion())));
    }

    public void publishProductAvailableIfRestocked(Offer offer, int previousStock) {
        if (previousStock != 0 || offer.getStock() <= 0) {
            return;
        }

        List<UUID> recipients = followRepository.findActiveRecipientIdsForRestockedOffer(
                offer.getProduct().getId(), offer.getCafeteria().getId(), ProductFollow.GENERAL);
        if (recipients.isEmpty()) {
            return;
        }

        journal.append(new CloudCoffeeEvent(
                UUID.randomUUID(),
                Instant.now(),
                traceId(),
                PRODUCT_AVAILABLE_EVENT,
                Map.of(
                        "ofertaId", offer.getId(),
                        "productoId", offer.getProduct().getId(),
                        "productoNombre", offer.getProduct().getName(),
                        "cafeteriaId", offer.getCafeteria().getId(),
                        "cafeteriaNombre", offer.getCafeteria().getName(),
                        "campusId", offer.getCafeteria().getCampus().getId(),
                        "campusNombre", offer.getCafeteria().getCampus().getName(),
                        "stockActual", offer.getStock(),
                        "version", offer.getVersion(),
                        "destinatarios", recipients.stream().map(UUID::toString).toList())));
    }

    private static String traceId() {
        String traceId = MDC.get("traceId");
        if (traceId == null || traceId.isBlank()) {
            traceId = UUID.randomUUID().toString().replace("-", "");
        }
        return traceId;
    }
}
