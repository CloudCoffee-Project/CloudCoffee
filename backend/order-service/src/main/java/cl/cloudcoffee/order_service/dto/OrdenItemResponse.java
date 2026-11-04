package cl.cloudcoffee.order_service.dto;

import cl.cloudcoffee.order_service.model.OrdenItem;
import java.util.UUID;

/** Snapshot histórico, sin consultar el catálogo ni exponer entidades JPA. */
public record OrdenItemResponse(UUID ordenItemId, UUID ofertaId, UUID productoId, String productoNombre,
        int cantidad, long precioUnitario, long subtotal) {
    public static OrdenItemResponse from(OrdenItem item) {
        return new OrdenItemResponse(item.getId(), item.getOfertaId(), item.getProductoId(),
                item.getProductoNombre(), item.getCantidad(), item.getPrecioUnitario().longValueExact(),
                item.getSubtotal().longValueExact());
    }
}
