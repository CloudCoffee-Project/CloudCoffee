package cl.cloudcoffee.order_service.dto;

import java.time.Instant;
import java.util.Locale;
import java.util.UUID;

import cl.cloudcoffee.order_service.model.EstadoPago;
import cl.cloudcoffee.order_service.model.MotivoPago;
import cl.cloudcoffee.order_service.model.Pago;

/**
 * Recurso Pago del contrato INT2-50 (#112), embebido en la compra y en {@code order.pago.resultado.v1}.
 * Un pago de payment-service (INT2-113) se informa con {@code simulado:false}, su proveedor real y el estado
 * público del contrato 2.0.0.
 */
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
    public static final String PROVEEDOR_SANDBOX = "mercadopago_sandbox";

    public static PagoResponse from(Pago pago) {
        boolean externo = pago.esExterno();
        return new PagoResponse(
                pago.getId(),
                pago.getCompra().getId(),
                estado(pago),
                motivo(pago),
                // Pesos CLP enteros: un importe con decimales es un error de datos.
                pago.getMonto().longValueExact(),
                MONEDA,
                !externo,
                externo ? PROVEEDOR_SANDBOX : PROVEEDOR,
                pago.getCreatedAt(),
                pago.getUpdatedAt() == null ? pago.getCreatedAt() : pago.getUpdatedAt(),
                // @Version parte en 0; el contrato numera desde 1.
                pago.getVersion() + 1);
    }

    /**
     * Estado público. El simulado conserva el contrato 1.0.0 (pendiente/aprobado/rechazado). Uno externo
     * distingue cancelado y vencido (contrato 2.0.0), que internamente son rechazos con su motivo.
     */
    public static String estado(Pago pago) {
        if (pago.getEstado() == EstadoPago.REQUIERE_CONCILIACION) return "requiere_conciliacion";
        if (pago.esExterno() && pago.getEstado() == EstadoPago.RECHAZADO) {
            if (pago.getMotivo() == MotivoPago.PROVEEDOR_CANCELADO || pago.getMotivo() == MotivoPago.COMPRA_CANCELADA) {
                return "cancelado";
            }
            if (pago.getMotivo() == MotivoPago.RESERVA_VENCIDA) return "vencido";
        }
        return pago.getEstado().name().toLowerCase(Locale.ROOT);
    }

    /** En conciliación se expone el motivo informado por Payment (aprobacion_tardia, monto_discrepante...). */
    public static String motivo(Pago pago) {
        if (pago.getEstado() == EstadoPago.REQUIERE_CONCILIACION && pago.getMotivoProveedor() != null) {
            return pago.getMotivoProveedor();
        }
        return pago.getMotivo() == null ? null : pago.getMotivo().codigo();
    }
}
