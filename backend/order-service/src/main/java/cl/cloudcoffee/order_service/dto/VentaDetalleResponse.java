package cl.cloudcoffee.order_service.dto;

import cl.cloudcoffee.order_service.model.Orden;
import java.util.Comparator;
import java.util.List;

public record VentaDetalleResponse(VentaResponse venta, List<OrdenItemResponse> items) {
    public static VentaDetalleResponse from(Orden orden) {
        var items = orden.getItems().stream().map(OrdenItemResponse::from)
                .sorted(Comparator.comparing(item -> item.ordenItemId().toString())).toList();
        return new VentaDetalleResponse(VentaResponse.from(orden), items);
    }
}
