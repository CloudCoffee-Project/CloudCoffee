package cl.cloudcoffee.catalog_service.dto;

import java.time.Instant;
import java.util.UUID;

import cl.cloudcoffee.catalog_service.model.entity.Offer;

public record OfertaAdminResponse(
        UUID ofertaId,
        UUID cafeteriaId,
        UUID productoId,
        String productoNombre,
        Integer precio,
        Integer stock,
        Boolean activa,
        Instant bajaAt,
        Long version
) {
    public static OfertaAdminResponse from(Offer offer) {
        return new OfertaAdminResponse(
                offer.getId(),
                offer.getCafeteria().getId(),
                offer.getProduct().getId(),
                offer.getProduct().getName(),
                offer.getPrice().intValueExact(),
                offer.getStock(),
                offer.isAdministrativeActive(),
                offer.getBajaAt(),
                offer.getVersion());
    }
}
