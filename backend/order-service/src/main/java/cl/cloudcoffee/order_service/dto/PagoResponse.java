package cl.cloudcoffee.order_service.dto;

import java.time.Instant;
import java.util.Locale;
import java.util.UUID;

import cl.cloudcoffee.order_service.model.Pago;

/** Recurso Pago del contrato INT2-50 (#112). */
public record PagoResponse(
        UUID pagoId,
        UUID compraId,
        String estado,
        String motivo,
        long montoTotal,
        String moneda,
        boolean simulado,
        String proveedor,
        Instant creadoAt,
        Instant actualizadoAt,
        long version
) {
    public static final String MONEDA = "CLP";
    public static final String PROVEEDOR = "simulado";

    public static PagoResponse from(Pago pago) {
        return new PagoResponse(
                pago.getId(),
                pago.getCompra().getId(),
                pago.getEstado().name().toLowerCase(Locale.ROOT),
                pago.getMotivo() == null ? null : pago.getMotivo().codigo(),
                // Pesos CLP enteros: un importe con decimales es un error de datos.
                pago.getMonto().longValueExact(),
                MONEDA,
                true,
                PROVEEDOR,
                pago.getCreatedAt(),
                pago.getUpdatedAt() == null ? pago.getCreatedAt() : pago.getUpdatedAt(),
                // @Version parte en 0; el contrato numera desde 1.
                pago.getVersion() + 1);
    }
}
