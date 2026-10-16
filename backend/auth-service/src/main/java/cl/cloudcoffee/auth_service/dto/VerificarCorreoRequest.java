package cl.cloudcoffee.auth_service.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.NotBlank;

public record VerificarCorreoRequest(
        @NotBlank(message = "El token es obligatorio.")
        @Schema(description = "Token opaco recibido por correo; no es el JWT de acceso", example = "token-correo-ficticio")
        String token
) {
}
