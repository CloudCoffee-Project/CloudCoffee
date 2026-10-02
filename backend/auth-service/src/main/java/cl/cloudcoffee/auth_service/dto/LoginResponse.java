package cl.cloudcoffee.auth_service.dto;

import io.swagger.v3.oas.annotations.media.Schema;

public record LoginResponse(
        @Schema(description = "JWT RS256 de acceso; usar en Authorization: Bearer", example = "jwt-ficticio-obtener-mediante-login")
        String accessToken,
        @Schema(description = "Token opaco de sesión; debe reemplazarse después de cada renovación", example = "refresh-token-ficticio")
        String refreshToken
) {
}
