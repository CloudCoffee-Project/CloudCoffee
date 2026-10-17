package cl.cloudcoffee.order_service.messaging;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import cl.cloudcoffee.order_service.model.EstadoPago;

/**
 * Resultado final de un pago, registrado dentro de la transacción. Se publica en
 * RabbitMQ solo después del commit (ver {@link PagoEventPublisher}).
 */
public record PagoFinalizado(
        UUID eventId,
        String traceId,
        UUID pagoId,
        UUID compraId,
        UUID usuarioId,
        EstadoPago estado,
        BigDecimal monto,
        String motivoRechazo,
        List<Item> items
) {
    public record Item(UUID ofertaId, int cantidad) {
    }
}
