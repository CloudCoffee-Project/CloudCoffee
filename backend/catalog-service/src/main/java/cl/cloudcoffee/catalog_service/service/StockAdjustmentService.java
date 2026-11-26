package cl.cloudcoffee.catalog_service.service;

import java.net.URI;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.Objects;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.catalog_service.dto.AdjustStockRequest;
import cl.cloudcoffee.catalog_service.dto.StockAdjustmentResponse;
import cl.cloudcoffee.catalog_service.messaging.StockEventPublisher;
import cl.cloudcoffee.catalog_service.model.entity.StockAdjustment;
import cl.cloudcoffee.catalog_service.model.enums.OfferStatus;
import cl.cloudcoffee.catalog_service.model.enums.StockReservationStatus;
import cl.cloudcoffee.catalog_service.repository.OfferRepository;
import cl.cloudcoffee.catalog_service.repository.StockAdjustmentRepository;
import cl.cloudcoffee.catalog_service.repository.StockReservationRepository;
import cl.cloudcoffee.errors.BusinessException;

@Service
public class StockAdjustmentService {
    private final OfferRepository offerRepository;
    private final StockReservationRepository reservationRepository;
    private final StockReservationService reservationService;
    private final StockAdjustmentRepository adjustmentRepository;
    private final StockEventPublisher stockEventPublisher;
    private final Clock clock;

    public StockAdjustmentService(OfferRepository offerRepository, StockReservationRepository reservationRepository,
            StockReservationService reservationService, StockAdjustmentRepository adjustmentRepository,
            StockEventPublisher stockEventPublisher, Clock clock) {
        this.offerRepository = offerRepository;
        this.reservationRepository = reservationRepository;
        this.reservationService = reservationService;
        this.adjustmentRepository = adjustmentRepository;
        this.stockEventPublisher = stockEventPublisher;
        this.clock = clock;
    }

    @Transactional
    public Result adjust(UUID cafeteriaId, UUID offerId, UUID actor, UUID idempotencyKey, AdjustStockRequest request) {
        // Reservar, confirmar, liberar y vencer siempre toman primero el bloqueo de la oferta.
        var offer = offerRepository.findForUpdateInCafeteria(offerId, cafeteriaId)
                .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "Oferta no encontrada",
                        "La oferta no existe en la cafetería indicada.", "OFERTA_NO_ENCONTRADA"));

        var existing = adjustmentRepository.findByOfferIdAndAdjustedByAndIdempotencyKey(
                offerId, actor, idempotencyKey);
        if (existing.isPresent()) {
            var adjustment = existing.get();
            if (adjustment.getQuantity() != request.cantidad() || adjustment.getReason() != request.motivo()
                    || !Objects.equals(adjustment.getNote(), request.nota())) {
                throw error(HttpStatus.CONFLICT, "Clave de idempotencia reutilizada",
                        "Usa una clave distinta para modificar un ajuste.", "IDEMPOTENCY_CONFLICT");
            }
            return new Result(StockAdjustmentResponse.from(adjustment), true);
        }

        int stockBeforeOperation = reservationService.expireForAdjustment(offerId);
        int previousStock = offer.getStock();
        long availableStock = (long) previousStock + request.cantidad();
        if (availableStock < 0) {
            throw error(HttpStatus.CONFLICT, "Stock negativo",
                    "El ajuste supera el stock disponible; las reservas pendientes se conservan.", "STOCK_NEGATIVO");
        }
        // Las unidades pendientes aún pueden regresar al stock al liberarse o vencer.
        long reserved = reservationRepository.sumQuantityByOfferAndStatus(offerId, StockReservationStatus.RESERVED);
        if (availableStock + reserved > Integer.MAX_VALUE) {
            throw error(HttpStatus.CONFLICT, "Stock fuera de rango",
                    "El total de unidades disponibles y reservadas excede el máximo admitido.", "STOCK_FUERA_DE_RANGO");
        }

        int stock = (int) availableStock;
        offer.setStock(stock);
        offer.setStatus(stock == 0 ? OfferStatus.OUT_OF_STOCK : OfferStatus.AVAILABLE);
        offerRepository.flush();

        StockAdjustment adjustment = new StockAdjustment();
        adjustment.setOffer(offer);
        adjustment.setAdjustedBy(actor);
        adjustment.setIdempotencyKey(idempotencyKey);
        adjustment.setQuantity(request.cantidad());
        adjustment.setReason(request.motivo());
        adjustment.setNote(request.nota());
        adjustment.setPreviousStock(previousStock);
        adjustment.setStock(stock);
        adjustment.setAdjustedAt(clock.instant().truncatedTo(ChronoUnit.MICROS));
        adjustmentRepository.saveAndFlush(adjustment);

        stockEventPublisher.publishStockUpdated(offer);
        stockEventPublisher.publishProductAvailableIfRestocked(offer, stockBeforeOperation);
        return new Result(StockAdjustmentResponse.from(adjustment), false);
    }

    private static BusinessException error(HttpStatus status, String title, String detail, String code) {
        return new BusinessException(status, URI.create("/problems/" + code.toLowerCase().replace('_', '-')),
                title, detail, code);
    }

    public record Result(StockAdjustmentResponse adjustment, boolean replayed) {
    }
}
