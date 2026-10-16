package cl.cloudcoffee.auth_service.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record PasswordResetRequest(
        @NotBlank(message = "El token es obligatorio.")
        @Schema(description = "Token opaco de recuperación recibido por correo; no es el JWT", example = "token-recuperacion-ficticio")
        String token,
        @NotBlank(message = "La contraseña es obligatoria.")
        @Size(min = 8, message = "La contraseña debe tener al menos 8 caracteres.")
        @Schema(description = "Nueva contraseña; mínimo 8 caracteres", example = "NuevaDemo123!", format = "password")
        String nuevaPassword
) {
    @Override
    public String toString() {
        return "PasswordResetRequest[token=[REDACTED], nuevaPassword=[REDACTED]]";
    }
}
