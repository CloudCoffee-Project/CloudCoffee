package cl.cloudcoffee.order_service.dto;

import java.time.Instant;
import java.util.UUID;

import cl.cloudcoffee.order_service.model.Pago;

/**
 * Recurso PagoSandbox del contrato Payment 2.0.0: la proyección de Order más la correlación con Payment y el
 * checkout. {@code initPoint} solo abre el checkout; el resultado se consulta siempre a Order.
 */
public record PagoSandboxResponse(
        UUID pagoId,
        UUID compraId,
        UUID paymentId,
        String preferenciaId,
        String initPoint,
        String estado,
        String motivo,
        long montoTotal,
        String moneda,
        boolean simulado,
        String proveedor,
        String entorno,
        Instant expiraAt,
        Instant creadoAt,
        Instant actualizadoAt,
        long version
) {
    public static PagoSandboxResponse from(Pago pago) {
        return new PagoSandboxResponse(
                pago.getId(),
                pago.getCompra().getId(),
                pago.getPaymentId(),
                pago.getPreferenciaId(),
                pago.getInitPoint(),
                PagoResponse.estado(pago),
                PagoResponse.motivo(pago),
                pago.getMonto().longValueExact(),
                PagoResponse.MONEDA,
                false,
                PagoResponse.PROVEEDOR_SANDBOX,
                "sandbox",
                pago.getCompra().getReservaExpiraAt(),
                pago.getCreatedAt(),
                pago.getUpdatedAt() == null ? pago.getCreatedAt() : pago.getUpdatedAt(),
                pago.getVersion() + 1);
    }
}
