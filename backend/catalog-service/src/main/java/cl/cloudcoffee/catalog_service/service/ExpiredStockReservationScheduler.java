package cl.cloudcoffee.catalog_service.service;

import java.time.Instant;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import cl.cloudcoffee.catalog_service.model.enums.StockReservationStatus;
import cl.cloudcoffee.catalog_service.repository.StockReservationRepository;

@Component
public class ExpiredStockReservationScheduler {

    private final StockReservationRepository reservationRepository;
    private final StockReservationService reservationService;

    public ExpiredStockReservationScheduler(
            StockReservationRepository reservationRepository,
            StockReservationService reservationService) {
        this.reservationRepository = reservationRepository;
        this.reservationService = reservationService;
    }

    @Scheduled(fixedDelayString = "${catalog.reservations.expiration-scan-ms:30000}")
    public void releaseExpiredReservations() {
        reservationRepository.findExpiredOfferIds(StockReservationStatus.RESERVED, Instant.now())
                .forEach(reservationService::expireForOffer);
    }
}
