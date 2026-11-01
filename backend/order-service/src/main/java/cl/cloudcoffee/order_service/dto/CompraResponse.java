package cl.cloudcoffee.order_service.dto;

import cl.cloudcoffee.order_service.model.Compra;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record CompraResponse(UUID compraId, UUID clienteId, String estado, long montoTotal, String moneda,
        List<OrdenResponse> ordenes, PagoResponse pago, Instant reservaExpiraAt, Instant creadoAt,
        Instant actualizadoAt, long version) {
    public static CompraResponse from(Compra compra, List<OrdenResponse> ordenes, PagoResponse pago) {
        return new CompraResponse(compra.getId(), compra.getUsuarioId(), compra.getEstado().codigo(),
                compra.getMontoTotal().longValueExact(), compra.getMoneda(), List.copyOf(ordenes), pago,
                compra.getReservaExpiraAt(), compra.getCreatedAt(), compra.getUpdatedAt(), compra.getVersion() + 1);
    }
}
