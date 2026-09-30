package cl.cloudcoffee.auth_service.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

public record PasswordRecoveryRequest(
        @NotBlank(message = "El correo es obligatorio.")
        @Email(message = "El correo debe ser válido.")
        @Schema(description = "Correo electrónico", example = "cliente@example.com", format = "email")
        String email
) {}
