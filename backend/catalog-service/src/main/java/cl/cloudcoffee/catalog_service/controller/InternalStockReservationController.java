package cl.cloudcoffee.catalog_service.controller;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import cl.cloudcoffee.catalog_service.dto.ReserveStockRequest;
import cl.cloudcoffee.catalog_service.dto.StockReservationResponse;
import cl.cloudcoffee.catalog_service.service.StockReservationService;

@RestController
@RequestMapping("/internal/servicios/catalogo/reservas")
public class InternalStockReservationController {

    private final StockReservationService reservationService;

    public InternalStockReservationController(StockReservationService reservationService) {
        this.reservationService = reservationService;
    }

    @PostMapping
    public ResponseEntity<StockReservationResponse> reserve(@RequestBody ReserveStockRequest request) {
        var result = reservationService.reserve(request);
        var response = StockReservationResponse.from(result.reservation());
        return result.created()
                ? ResponseEntity.status(HttpStatus.CREATED).body(response)
                : ResponseEntity.ok(response);
    }

    @PostMapping("/{reservationId}/confirmar")
    public StockReservationResponse confirmReservation(@PathVariable UUID reservationId) {
        return StockReservationResponse.from(reservationService.confirm(reservationId));
    }

    @PostMapping("/{reservationId}/liberar")
    public StockReservationResponse releaseReservation(@PathVariable UUID reservationId) {
        return StockReservationResponse.from(reservationService.release(reservationId));
    }

    @PostMapping("/{orderId}/{offerId}/confirmar")
    public StockReservationResponse confirm(@PathVariable UUID orderId, @PathVariable UUID offerId) {
        return StockReservationResponse.from(reservationService.confirm(orderId, offerId));
    }

    @PostMapping("/{orderId}/{offerId}/liberar")
    public ResponseEntity<StockReservationResponse> release(
            @PathVariable UUID orderId, @PathVariable UUID offerId) {
        return ResponseEntity.ok(StockReservationResponse.from(reservationService.release(orderId, offerId)));
    }
}
