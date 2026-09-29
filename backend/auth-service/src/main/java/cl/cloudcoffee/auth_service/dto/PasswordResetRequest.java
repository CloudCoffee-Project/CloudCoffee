package cl.cloudcoffee.auth_service.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record PasswordResetRequest(
        @NotBlank(message = "El token es obligatorio.") String token,
        @NotBlank(message = "La contraseña es obligatoria.")
        @Size(min = 8, message = "La contraseña debe tener al menos 8 caracteres.")
        String nuevaPassword
) {
    @Override
    public String toString() {
        return "PasswordResetRequest[token=[REDACTED], nuevaPassword=[REDACTED]]";
    }
}
