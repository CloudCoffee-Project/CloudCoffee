package cl.cloudcoffee.catalog_service.service;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.catalog_service.dto.ReserveStockRequest;
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
    private final Duration reservationTtl;

    public StockReservationService(
            OfferRepository offerRepository,
            StockReservationRepository reservationRepository,
            @Value("${catalog.reservations.ttl:PT5M}") Duration reservationTtl) {
        if (reservationTtl.compareTo(Duration.ofNanos(1_000)) < 0) {
            throw new IllegalArgumentException("catalog.reservations.ttl debe ser de al menos un microsegundo");
        }
        this.offerRepository = offerRepository;
        this.reservationRepository = reservationRepository;
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

        expireReservationsForOffer(offer, Instant.now());

        var existing = reservationRepository.findByOrderIdAndOfferIdForUpdate(
                request.orderId(), request.offerId());
        if (existing.isPresent()) {
            StockReservation reservation = existing.get();
            if (!reservation.getQuantity().equals(request.quantity())) {
                throw error(HttpStatus.CONFLICT, "La orden ya tiene una reserva",
                        "Una repetición de esta oferta debe usar la cantidad de la reserva original.",
                        "RESERVA_IDEMPOTENTE_CONFLICTIVA");
            }
            return new ReservationResult(reservation, false);
        }

        if (offer.getStatus() != OfferStatus.AVAILABLE
                || offerRepository.reserveStock(request.offerId(), request.quantity()) != 1) {
            throw error(HttpStatus.CONFLICT, "Stock no disponible",
                    "La oferta no está activa o no tiene stock suficiente para la cantidad solicitada.",
                    "STOCK_NO_DISPONIBLE");
        }

        Instant reservedAt = Instant.now().truncatedTo(ChronoUnit.MICROS);
        StockReservation reservation = new StockReservation();
        reservation.setOrderId(request.orderId());
        reservation.setOffer(offer);
        reservation.setQuantity(request.quantity());
        reservation.setStatus(StockReservationStatus.RESERVED);
        reservation.setReservedAt(reservedAt);
        reservation.setExpiresAt(reservedAt.plus(reservationTtl).truncatedTo(ChronoUnit.MICROS));
        return new ReservationResult(reservationRepository.save(reservation), true);
    }

    @Transactional
    public StockReservation confirm(UUID orderId, UUID offerId) {
        Offer offer = lockOffer(offerId);
        StockReservation reservation = lockReservation(orderId, offerId);
        expireReservationsForOffer(offer, Instant.now());
        if (reservation.getStatus() == StockReservationStatus.EXPIRED) {
            return reservation;
        }
        if (reservation.getStatus() != StockReservationStatus.RESERVED) {
            throw invalidTransition("Solo se puede confirmar una reserva vigente.");
        }
        reservation.setStatus(StockReservationStatus.CONFIRMED);
        return reservation;
    }

    @Transactional
    public StockReservation release(UUID orderId, UUID offerId) {
        Offer offer = lockOffer(offerId);
        StockReservation reservation = lockReservation(orderId, offerId);
        expireReservationsForOffer(offer, Instant.now());
        if (reservation.getStatus() == StockReservationStatus.EXPIRED
                || reservation.getStatus() == StockReservationStatus.RELEASED) {
            return reservation;
        }
        if (reservation.getStatus() != StockReservationStatus.RESERVED) {
            throw invalidTransition("Solo se puede liberar una reserva pendiente de confirmación.");
        }
        restoreStock(offer, reservation.getQuantity());
        reservation.setStatus(StockReservationStatus.RELEASED);
        return reservation;
    }

    @Transactional
    public void expireForOffer(UUID offerId) {
        Offer offer = lockOffer(offerId);
        expireReservationsForOffer(offer, Instant.now());
    }

    private StockReservation lockReservation(UUID orderId, UUID offerId) {
        return reservationRepository.findByOrderIdAndOfferIdForUpdate(orderId, offerId)
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
    }

    private static void restoreStock(Offer offer, int quantity) {
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
