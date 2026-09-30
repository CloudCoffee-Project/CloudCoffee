package cl.cloudcoffee.catalog_service.dto;


import java.math.BigDecimal;
import java.util.UUID;
import cl.cloudcoffee.catalog_service.model.entity.Offer;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class ProductOfferResponse {
    private UUID id;
    private UUID cafeteriaId;
    private String cafeteriaName;
    private BigDecimal price;
    private Integer stock;
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

