package cl.cloudcoffee.catalog_service.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import tools.jackson.databind.JsonNode;

public record AdjustStockRequest(
        @Schema(description = "Cantidad total sin vender, incluidas las reservas pendientes", example = "20", minimum = "0", requiredMode = Schema.RequiredMode.REQUIRED)
        Integer quantity) {

    @JsonCreator
    public static AdjustStockRequest fromJson(@JsonProperty("quantity") JsonNode quantity) {
        if (quantity == null || quantity.isNull()) {
            return new AdjustStockRequest(null);
        }
        if (!quantity.isIntegralNumber() || !quantity.canConvertToInt()) {
            throw new IllegalArgumentException("quantity debe ser un entero de 32 bits.");
        }
        return new AdjustStockRequest(quantity.intValue());
    }
}
