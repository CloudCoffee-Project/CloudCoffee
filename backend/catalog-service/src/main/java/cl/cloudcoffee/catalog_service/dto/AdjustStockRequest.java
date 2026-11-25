package cl.cloudcoffee.catalog_service.dto;

import cl.cloudcoffee.catalog_service.model.enums.StockAdjustmentReason;
import com.fasterxml.jackson.annotation.JsonCreator;
import io.swagger.v3.oas.annotations.media.Schema;
import tools.jackson.databind.JsonNode;

public record AdjustStockRequest(
        @Schema(description = "Delta sobre el stock disponible, distinto de cero", example = "12",
                minimum = "-10000", maximum = "10000", requiredMode = Schema.RequiredMode.REQUIRED)
        int cantidad,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) StockAdjustmentReason motivo,
        @Schema(minLength = 1, maxLength = 200) String nota) {

    public AdjustStockRequest {
        if (cantidad == 0 || cantidad < -10_000 || cantidad > 10_000) {
            throw new IllegalArgumentException("cantidad debe estar entre -10000 y 10000 y ser distinta de cero.");
        }
        if (motivo == null) {
            throw new IllegalArgumentException("motivo es obligatorio.");
        }
        if (nota != null) {
            nota = nota.strip();
            if (nota.isEmpty() || nota.codePointCount(0, nota.length()) > 200) {
                throw new IllegalArgumentException("nota debe tener entre 1 y 200 caracteres.");
            }
        }
    }

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static AdjustStockRequest fromJson(JsonNode body) {
        if (!body.isObject() || body.size() != (body.has("nota") ? 3 : 2)
                || !body.path("cantidad").isIntegralNumber() || !body.path("cantidad").canConvertToInt()
                || !body.path("motivo").isString()
                || (body.has("nota") && !body.path("nota").isString())) {
            throw new IllegalArgumentException("Se requiere cantidad entera, motivo válido y, si se envía, nota de texto.");
        }
        return new AdjustStockRequest(body.path("cantidad").intValue(),
                StockAdjustmentReason.valueOf(body.path("motivo").asString()),
                body.has("nota") ? body.path("nota").asString() : null);
    }
}
