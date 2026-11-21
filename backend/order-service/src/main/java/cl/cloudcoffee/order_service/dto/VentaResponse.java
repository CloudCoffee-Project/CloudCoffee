package cl.cloudcoffee.order_service.dto;

import cl.cloudcoffee.order_service.model.EstadoOrden;
import cl.cloudcoffee.order_service.model.Orden;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** Snapshot de una sola orden y su monto, sin datos del comprador. */
public record VentaResponse(UUID ordenId, UUID compraId, String codigoOrden, UUID cafeteriaId,
        String cafeteriaNombre, UUID campusId, String estado, long montoTotal, String moneda, int cantidadItems,
        Instant pagadoAt, Instant entregadoAt) {
    public VentaResponse(UUID ordenId, UUID compraId, String codigoOrden, UUID cafeteriaId,
            String cafeteriaNombre, UUID campusId, EstadoOrden estado, BigDecimal montoTotal, String moneda,
            int cantidadItems, Instant pagadoAt, Instant entregadoAt) {
        this(ordenId, compraId, codigoOrden, cafeteriaId, cafeteriaNombre, campusId, estado.codigo(),
                montoTotal.longValueExact(), moneda, cantidadItems, pagadoAt, entregadoAt);
    }

    public static VentaResponse from(Orden orden) {
        return new VentaResponse(orden.getId(), orden.getCompra().getId(), orden.getCodigoOrden(),
                orden.getCafeteriaId(), orden.getCafeteriaNombre(), orden.getCampusId(), orden.getEstado(),
                orden.getMontoTotal(), orden.getMoneda(), orden.getItems().size(), orden.getPagadoAt(),
                orden.getEntregadoAt());
    }
}
