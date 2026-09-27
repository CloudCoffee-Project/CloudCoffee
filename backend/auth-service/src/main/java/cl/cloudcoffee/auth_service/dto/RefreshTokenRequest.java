package cl.cloudcoffee.auth_service.dto;

import jakarta.validation.constraints.NotBlank;

public record RefreshTokenRequest(
        @NotBlank(message = "El refresh token es obligatorio.")
        String refreshToken
) {
}
