package cl.cloudcoffee.catalog_service.dto;

import java.util.UUID;

import io.swagger.v3.oas.annotations.media.Schema;

/** Alineado con el tipo Seguimiento de la app: producto obligatorio y cafetería opcional. */
public record CrearSeguimientoRequest(
        @Schema(description = "UUID del producto a seguir", example = "33333333-3333-4333-8333-333333333333",
                requiredMode = Schema.RequiredMode.REQUIRED)
        UUID productoId,
        @Schema(description = "UUID de la cafetería; omitir o null para seguir el producto en cualquier cafetería",
                example = "44444444-4444-4444-8444-444444444444", nullable = true)
        UUID cafeteriaId
) {
}
