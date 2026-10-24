package cl.cloudcoffee.catalog_service.service;

import java.net.URI;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.catalog_service.dto.AdjustStockRequest;
import cl.cloudcoffee.catalog_service.dto.StockAdjustmentResponse;
import cl.cloudcoffee.catalog_service.messaging.StockChangedEvent;
import cl.cloudcoffee.catalog_service.model.entity.StockAdjustment;
import cl.cloudcoffee.catalog_service.model.enums.OfferStatus;
import cl.cloudcoffee.catalog_service.model.enums.StockReservationStatus;
import cl.cloudcoffee.catalog_service.repository.OfferRepository;
import cl.cloudcoffee.catalog_service.repository.StockAdjustmentRepository;
import cl.cloudcoffee.catalog_service.repository.StockReservationRepository;
import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.security.CafeteriaAccess;
import io.micrometer.tracing.Tracer;

@Service
public class StockAdjustmentService {
    private final CafeteriaAccess cafeteriaAccess;
    private final OfferRepository offerRepository;
    private final StockReservationRepository reservationRepository;
    private final StockReservationService reservationService;
    private final StockAdjustmentRepository adjustmentRepository;
    private final ApplicationEventPublisher events;
    private final Tracer tracer;

    public StockAdjustmentService(CafeteriaAccess cafeteriaAccess, OfferRepository offerRepository,
            StockReservationRepository reservationRepository, StockReservationService reservationService,
            StockAdjustmentRepository adjustmentRepository, ApplicationEventPublisher events, Tracer tracer) {
        this.cafeteriaAccess = cafeteriaAccess;
        this.offerRepository = offerRepository;
        this.reservationRepository = reservationRepository;
        this.reservationService = reservationService;
        this.adjustmentRepository = adjustmentRepository;
        this.events = events;
        this.tracer = tracer;
    }

    @Transactional
    public StockAdjustmentResponse adjust(UUID cafeteriaId, UUID offerId, AdjustStockRequest request,
            Authentication authentication) {
        if (!(authentication instanceof JwtAuthenticationToken token)
                || !"ADMIN_CAFETERIA".equals(token.getToken().getClaimAsString("role"))) {
            throw new AccessDeniedException("Solo ADMIN_CAFETERIA puede ajustar el stock.");
        }
        cafeteriaAccess.verificar(authentication, cafeteriaId);
        if (request.quantity() == null || request.quantity() < 0) {
            throw error(HttpStatus.BAD_REQUEST, "Cantidad inválida",
                    "La cantidad total es obligatoria y no puede ser negativa.", "CANTIDAD_INVALIDA");
        }

        // Mismo bloqueo y orden que reservar, confirmar, liberar y vencer reservas.
        var offer = offerRepository.findByIdForUpdate(offerId)
                .filter(value -> value.getCafeteria().getId().equals(cafeteriaId))
                .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "Oferta no encontrada",
                        "La oferta no existe en la cafetería indicada.", "OFERTA_NO_ENCONTRADA"));
        reservationService.expireForOffer(offerId);
        long reserved = reservationRepository.sumQuantityByOfferAndStatus(offerId, StockReservationStatus.RESERVED);
        if (request.quantity() < reserved) {
            throw error(HttpStatus.CONFLICT, "Stock comprometido",
                    "La cantidad total no puede ser menor que las unidades con reserva pendiente.",
                    "STOCK_COMPROMETIDO");
        }

        int previousStock = offer.getStock();
        int stock = (int) (request.quantity() - reserved);
        offer.setStock(stock);
        offer.setStatus(stock == 0 ? OfferStatus.OUT_OF_STOCK : OfferStatus.AVAILABLE);
        offerRepository.flush();

        StockAdjustment adjustment = new StockAdjustment();
        adjustment.setOffer(offer);
        adjustment.setAdjustedBy(UUID.fromString(token.getToken().getSubject()));
        adjustment.setQuantity(request.quantity());
        adjustment.setReservedQuantity(reserved);
        adjustment.setPreviousStock(previousStock);
        adjustment.setStock(stock);
        adjustment.setVersion(offer.getVersion());
        adjustment.setAdjustedAt(Instant.now().truncatedTo(ChronoUnit.MICROS));
        adjustmentRepository.saveAndFlush(adjustment);

        var span = tracer.nextSpan().name("catalog.stock.adjustment").start();
        try (var scope = tracer.withSpan(span)) {
            events.publishEvent(new StockChangedEvent(UUID.randomUUID(), adjustment.getAdjustedAt(),
                    span.context().traceId(), offerId, offer.getProduct().getId(), cafeteriaId,
                    offer.getCafeteria().getCampus().getId(), stock, offer.getVersion()));
        } finally {
            span.end();
        }
        return StockAdjustmentResponse.from(adjustment);
    }

    private static BusinessException error(HttpStatus status, String title, String detail, String code) {
        return new BusinessException(status, URI.create("/problems/" + code.toLowerCase().replace('_', '-')),
                title, detail, code);
    }
}
