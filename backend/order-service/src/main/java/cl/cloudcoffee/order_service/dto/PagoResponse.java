package cl.cloudcoffee.order_service.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import cl.cloudcoffee.order_service.model.EstadoPago;
import cl.cloudcoffee.order_service.model.Pago;

public record PagoResponse(
        UUID pagoId,
        UUID compraId,
        EstadoPago estado,
        BigDecimal monto,
        String motivoRechazo,
        Instant creadoEn,
        Instant actualizadoEn
) {
    public static PagoResponse from(Pago pago) {
        return new PagoResponse(pago.getId(), pago.getCompra().getId(), pago.getEstado(), pago.getMonto(),
                pago.getMotivoRechazo(), pago.getCreatedAt(), pago.getUpdatedAt());
    }
}
