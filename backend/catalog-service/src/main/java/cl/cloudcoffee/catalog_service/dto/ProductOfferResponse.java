package cl.cloudcoffee.catalog_service.dto;

import io.swagger.v3.oas.annotations.media.Schema;


import java.math.BigDecimal;
import java.util.UUID;
import cl.cloudcoffee.catalog_service.model.entity.Offer;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class ProductOfferResponse {
    @Schema(description = "Identificador UUID", example = "11111111-1111-4111-8111-111111111111")
    private UUID id;
    @Schema(description = "UUID de la cafetería", example = "44444444-4444-4444-8444-444444444444")
    private UUID cafeteriaId;
    @Schema(description = "Nombre de la cafetería", example = "Cafetería Ejemplo")
    private String cafeteriaName;
    @Schema(description = "Precio de la oferta", example = "1500.00")
    private BigDecimal price;
    @Schema(description = "Unidades en stock", example = "10")
    private Integer stock;
    @Schema(description = "Indica stock mayor que cero", example = "true")
    private Boolean disponible;

    public static ProductOfferResponse from(Offer offer) {
        ProductOfferResponse response = new ProductOfferResponse();
        response.setId(offer.getId());
        response.setCafeteriaId(offer.getCafeteria().getId());
        response.setCafeteriaName(offer.getCafeteria().getName());
        response.setPrice(offer.getPrice());
        response.setStock(offer.getStock());
        response.setDisponible(offer.getStock() > 0);
        return response;
    }
}

