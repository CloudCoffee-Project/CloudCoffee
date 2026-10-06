package cl.cloudcoffee.auth_service.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ChangePasswordRequest(
        @NotBlank(message = "La contraseña actual es obligatoria")
        @Schema(description = "Contraseña actual", example = "CafeDemo123!", format = "password")
        String passwordActual,

        @NotBlank(message = "La nueva contraseña es obligatoria")
        @Size(min = 6, message = "La nueva contraseña debe tener al menos 6 caracteres")
        @Schema(description = "Nueva contraseña; mínimo actual de 6 caracteres", example = "NuevaDemo123!", format = "password")
        String passwordNueva
) {}