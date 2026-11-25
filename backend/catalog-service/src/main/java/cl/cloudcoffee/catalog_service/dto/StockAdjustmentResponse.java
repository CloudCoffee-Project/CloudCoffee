package cl.cloudcoffee.catalog_service.dto;

import java.time.Instant;
import java.util.UUID;

import cl.cloudcoffee.catalog_service.model.enums.StockAdjustmentReason;
import cl.cloudcoffee.catalog_service.model.entity.StockAdjustment;

public record StockAdjustmentResponse(
        UUID ajusteId, UUID ofertaId, int cantidad, StockAdjustmentReason motivo, String nota, int stockAnterior,
        int stockActual, UUID realizadoPor, Instant realizadoAt) {

    public static StockAdjustmentResponse from(StockAdjustment adjustment) {
        return new StockAdjustmentResponse(adjustment.getId(), adjustment.getOffer().getId(),
                adjustment.getQuantity(), adjustment.getReason(), adjustment.getNote(),
                adjustment.getPreviousStock(), adjustment.getStock(), adjustment.getAdjustedBy(),
                adjustment.getAdjustedAt());
    }
}
