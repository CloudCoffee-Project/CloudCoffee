package cl.cloudcoffee.catalog_service.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

public record EditarOfertaRequest(
        @NotNull @Min(1) @Max(1_000_000) @Schema(example = "1900") Integer precio,
        @NotNull @Min(1) @Schema(example = "4") Long version
) {}
