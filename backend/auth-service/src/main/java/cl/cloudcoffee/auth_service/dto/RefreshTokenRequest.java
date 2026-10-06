package cl.cloudcoffee.auth_service.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.NotBlank;

public record RefreshTokenRequest(
        @NotBlank(message = "El refresh token es obligatorio.")
        @Schema(description = "Token opaco de sesión; debe reemplazarse después de cada renovación", example = "refresh-token-ficticio")
        String refreshToken
) {
}
