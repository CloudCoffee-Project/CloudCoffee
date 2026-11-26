package cl.cloudcoffee.catalog_service.dto;

import java.util.UUID;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

public record CrearOfertaRequest(
        @NotNull @Schema(example = "55555555-5555-4555-8555-555555555501") UUID productoId,
        @NotNull @Min(1) @Max(1_000_000) @Schema(example = "1800") Integer precio,
        @NotNull @Min(0) @Max(100_000) @Schema(example = "20") Integer stockInicial
) {}
