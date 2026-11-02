package cl.cloudcoffee.catalog_service.service;

import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import jakarta.persistence.EntityManager;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.catalog_service.dto.ReserveStockRequest;
import cl.cloudcoffee.catalog_service.messaging.StockEventPublisher;
import cl.cloudcoffee.catalog_service.model.entity.Offer;
import cl.cloudcoffee.catalog_service.model.entity.StockReservation;
import cl.cloudcoffee.catalog_service.model.enums.OfferStatus;
import cl.cloudcoffee.catalog_service.model.enums.StockReservationStatus;
import cl.cloudcoffee.catalog_service.repository.OfferRepository;
import cl.cloudcoffee.catalog_service.repository.StockReservationRepository;
import cl.cloudcoffee.errors.BusinessException;

@Service
public class StockReservationService {

    private final OfferRepository offerRepository;
    private final StockReservationRepository reservationRepository;
    private final EntityManager entityManager;
    private final StockEventPublisher stockEventPublisher;
    private final Clock clock;
    private final Duration reservationTtl;

    public StockReservationService(
            OfferRepository offerRepository,
            StockReservationRepository reservationRepository,
            EntityManager entityManager,
            StockEventPublisher stockEventPublisher,
            Clock clock,
            @Value("${catalog.reservations.ttl:PT5M}") Duration reservationTtl) {
        if (reservationTtl.compareTo(Duration.ofNanos(1_000)) < 0) {
            throw new IllegalArgumentException("catalog.reservations.ttl debe ser de al menos un microsegundo");
        }
        this.offerRepository = offerRepository;
        this.reservationRepository = reservationRepository;
        this.entityManager = entityManager;
        this.stockEventPublisher = stockEventPublisher;
        this.clock = clock;
        this.reservationTtl = reservationTtl;
    }

    @Transactional
    public ReservationResult reserve(ReserveStockRequest request) {
        if (request.orderId() == null || request.offerId() == null) {
            throw error(HttpStatus.BAD_REQUEST, "Solicitud de reserva inválida",
                    "orderId y offerId son obligatorios.", "RESERVA_INVALIDA");
        }
        if (request.quantity() == null || request.quantity() <= 0) {
            throw error(HttpStatus.BAD_REQUEST, "Cantidad inválida",
                    "La cantidad a reservar debe ser positiva.", "CANTIDAD_INVALIDA");
        }

        Offer offer = offerRepository.findByIdForUpdate(request.offerId())
                .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "Oferta no encontrada",
                        "No existe una oferta con el identificador indicado.", "OFERTA_NO_ENCONTRADA"));

        expireReservationsForOffer(offer, clock.instant());

        var existing = reservationRepository.findByOrderIdAndOfferIdAndAttemptIdForUpdate(
                request.orderId(), request.offerId(), request.attemptId());
        if (existing.isPresent()) {
            StockReservation reservation = existing.get();
            if (!reservation.getQuantity().equals(request.quantity())) {
                throw error(HttpStatus.CONFLICT, "La orden ya tiene una reserva",
                        "Una repetición de esta oferta debe usar la cantidad de la reserva original.",
                        "RESERVA_IDEMPOTENTE_CONFLICTIVA");
            }
            return new ReservationResult(reservation, false);
        }

        if (reservationRepository.existsByOrderIdAndOfferIdAndStatusIn(request.orderId(), request.offerId(),
                List.of(StockReservationStatus.RESERVED, StockReservationStatus.CONFIRMED))) {
            throw error(HttpStatus.CONFLICT, "La orden ya tiene una reserva activa o confirmada",
                    "Libera el intento anterior antes de crear otro; una reserva confirmada no admite otro intento.",
                    "RESERVA_INTENTO_CONFLICTIVO");
        }

        if (offer.getStatus() != OfferStatus.AVAILABLE
                || offerRepository.reserveStock(request.offerId(), request.quantity()) != 1) {
            throw error(HttpStatus.CONFLICT, "Stock no disponible",
                    "La oferta no está activa o no tiene stock suficiente para la cantidad solicitada.",
                    "STOCK_NO_DISPONIBLE");
        }
        entityManager.refresh(offer);

        Instant reservedAt = clock.instant().truncatedTo(ChronoUnit.MICROS);
        StockReservation reservation = new StockReservation();
        reservation.setOrderId(request.orderId());
        reservation.setAttemptId(request.attemptId());
        reservation.setOffer(offer);
        reservation.setQuantity(request.quantity());
        reservation.setStatus(StockReservationStatus.RESERVED);
        reservation.setReservedAt(reservedAt);
        reservation.setExpiresAt(reservedAt.plus(reservationTtl).truncatedTo(ChronoUnit.MICROS));
        StockReservation savedReservation = reservationRepository.saveAndFlush(reservation);
        stockEventPublisher.publishStockUpdated(offer);
        return new ReservationResult(savedReservation, true);
    }

    @Transactional
    public StockReservation confirm(UUID orderId, UUID offerId) {
        Offer offer = lockOffer(offerId);
        StockReservation reservation = lockReservation(orderId, offerId);
        return confirmLocked(offer, reservation);
    }

    private StockReservation confirmLocked(Offer offer, StockReservation reservation) {
        expireReservationsForOffer(offer, clock.instant());
        if (reservation.getStatus() == StockReservationStatus.EXPIRED) {
            return reservation;
        }
        if (reservation.getStatus() == StockReservationStatus.CONFIRMED) {
            return reservation;
        }
        if (reservation.getStatus() != StockReservationStatus.RESERVED) {
            throw invalidTransition("Solo se puede confirmar una reserva vigente.");
        }
        reservation.setStatus(StockReservationStatus.CONFIRMED);
        return reservation;
    }

    @Transactional
    public StockReservation confirm(UUID reservationId) {
        Offer offer = lockOfferForReservation(reservationId);
        return confirmLocked(offer, lockReservation(reservationId));
    }

    @Transactional
    public StockReservation release(UUID orderId, UUID offerId) {
        Offer offer = lockOffer(offerId);
        StockReservation reservation = lockReservation(orderId, offerId);
        return releaseLocked(offer, reservation);
    }

    private StockReservation releaseLocked(Offer offer, StockReservation reservation) {
        expireReservationsForOffer(offer, clock.instant());
        if (reservation.getStatus() == StockReservationStatus.EXPIRED
                || reservation.getStatus() == StockReservationStatus.RELEASED) {
            return reservation;
        }
        if (reservation.getStatus() != StockReservationStatus.RESERVED) {
            throw invalidTransition("Solo se puede liberar una reserva pendiente de confirmación.");
        }
        restoreStock(offer, reservation.getQuantity());
        reservation.setStatus(StockReservationStatus.RELEASED);
        offerRepository.flush();
        stockEventPublisher.publishStockUpdated(offer);
        return reservation;
    }

    @Transactional
    public StockReservation release(UUID reservationId) {
        Offer offer = lockOfferForReservation(reservationId);
        return releaseLocked(offer, lockReservation(reservationId));
    }

    @Transactional
    public void expireForOffer(UUID offerId) {
        Offer offer = lockOffer(offerId);
        expireReservationsForOffer(offer, clock.instant());
    }

    private StockReservation lockReservation(UUID orderId, UUID offerId) {
        return reservationRepository.findByOrderIdAndOfferIdAndAttemptIdForUpdate(
                orderId, offerId, StockReservation.LEGACY_ATTEMPT_ID)
                .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "Reserva no encontrada",
                        "No existe una reserva para esa orden y oferta.", "RESERVA_NO_ENCONTRADA"));
    }

    private Offer lockOffer(UUID offerId) {
        return offerRepository.findByIdForUpdate(offerId)
                .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "Oferta no encontrada",
                        "No existe una oferta con el identificador indicado.", "OFERTA_NO_ENCONTRADA"));
    }

    private void expireReservationsForOffer(Offer offer, Instant now) {
        var expired = reservationRepository.findExpiredForOfferForUpdate(
                offer.getId(), StockReservationStatus.RESERVED, now);
        if (expired.isEmpty()) {
            return;
        }
        int releasedQuantity = 0;
        for (StockReservation reservation : expired) {
            reservation.setStatus(StockReservationStatus.EXPIRED);
            releasedQuantity += reservation.getQuantity();
        }
        restoreStock(offer, releasedQuantity);
        offerRepository.flush();
        stockEventPublisher.publishStockUpdated(offer);
    }

    private Offer lockOfferForReservation(UUID reservationId) {
        UUID offerId = reservationRepository.findOfferIdByReservationId(reservationId)
                .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "Reserva no encontrada",
                        "No existe una reserva con el identificador indicado.", "RESERVA_NO_ENCONTRADA"));
        return lockOffer(offerId);
    }

    private StockReservation lockReservation(UUID reservationId) {
        return reservationRepository.findByIdForUpdate(reservationId)
                .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "Reserva no encontrada",
                        "No existe una reserva con el identificador indicado.", "RESERVA_NO_ENCONTRADA"));
    }

    private void restoreStock(Offer offer, int quantity) {
        offer.setStock(offer.getStock() + quantity);
        offer.setStatus(OfferStatus.AVAILABLE);
    }

    private static BusinessException invalidTransition(String detail) {
        return error(HttpStatus.CONFLICT, "Estado de reserva inválido", detail, "TRANSICION_RESERVA_INVALIDA");
    }

    private static BusinessException error(HttpStatus status, String title, String detail, String code) {
        return new BusinessException(status, URI.create("/problems/" + code.toLowerCase().replace('_', '-')),
                title, detail, code);
    }

    public record ReservationResult(StockReservation reservation, boolean created) {
    }
}
