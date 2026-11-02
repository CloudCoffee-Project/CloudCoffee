package cl.cloudcoffee.order_service.dto;

import cl.cloudcoffee.order_service.model.Orden;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

public record OrdenResponse(UUID ordenId, UUID compraId, String codigoOrden, UUID cafeteriaId,
        String cafeteriaNombre, String estado, long montoTotal, String moneda, List<OrdenItemResponse> items,
        Instant reservaExpiraAt, Instant retiroHasta, Instant entregadoAt, Instant creadoAt,
        Instant actualizadoAt, long version) {
    public static OrdenResponse from(Orden orden) {
        List<OrdenItemResponse> items = orden.getItems().stream().map(OrdenItemResponse::from)
                .sorted(Comparator.comparing(item -> item.ordenItemId().toString())).toList();
        return new OrdenResponse(orden.getId(), orden.getCompra().getId(), orden.getCodigoOrden(),
                orden.getCafeteriaId(), orden.getCafeteriaNombre(), orden.getEstado().codigo(),
                orden.getMontoTotal().longValueExact(), orden.getMoneda(), items, orden.getReservaExpiraAt(),
                orden.getRetiroHasta(), orden.getEntregadoAt(), orden.getCreatedAt(), orden.getUpdatedAt(),
                orden.getVersion() + 1);
    }
}
