package cl.cloudcoffee.catalog_service.dto;

import java.time.Instant;
import java.util.UUID;

import cl.cloudcoffee.catalog_service.model.entity.StockReservation;
import cl.cloudcoffee.catalog_service.model.enums.StockReservationStatus;

public record StockReservationResponse(
        UUID orderId,
        UUID offerId,
        int quantity,
        StockReservationStatus status,
        Instant reservedAt,
        Instant expiresAt) {

    public static StockReservationResponse from(StockReservation reservation) {
        return new StockReservationResponse(
                reservation.getOrderId(),
                reservation.getOffer().getId(),
                reservation.getQuantity(),
                reservation.getStatus(),
                reservation.getReservedAt(),
                reservation.getExpiresAt());
    }
}
