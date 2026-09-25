package cl.cloudcoffee.auth_service.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

public record LoginRequest(
        @NotBlank(message = "El correo es obligatorio.")
        @Email(message = "El correo debe ser válido.")
        String email,

        @NotBlank(message = "La contraseña es obligatoria.")
        String password
) {
}
