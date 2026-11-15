package cl.cloudcoffee.catalog_service.dto;

import java.math.BigDecimal;
import java.util.UUID;
import cl.cloudcoffee.catalog_service.model.entity.Offer;

/** Cotización interna: nunca acepta importes ni identidad suministrados por un comprador. */
public record OfertaCompraResponse(UUID ofertaId, UUID productoId, String productoNombre,
        UUID cafeteriaId, String cafeteriaNombre, UUID campusId, BigDecimal precioUnitario) {
    public static OfertaCompraResponse from(Offer oferta) {
        return new OfertaCompraResponse(oferta.getId(), oferta.getProduct().getId(), oferta.getProduct().getName(),
                oferta.getCafeteria().getId(), oferta.getCafeteria().getName(),
                oferta.getCafeteria().getCampus().getId(), oferta.getPrice());
    }
}
