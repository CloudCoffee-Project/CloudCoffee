package cl.cloudcoffee.auth_service.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record RegistroClienteRequest(

        @NotBlank(message = "El correo es obligatorio.")
        @Email(message = "El correo debe ser válido.")
        @Schema(description = "Correo electrónico", example = "cliente@example.com", format = "email")
        String email,

        @NotBlank(message = "La contraseña es obligatoria.")
        @Size(min = 8, message = "La contraseña debe tener al menos 8 caracteres.")
        @Schema(description = "Contraseña; mínimo 8 caracteres en registro", example = "CafeDemo123!", format = "password")
        String password,

        @NotBlank(message = "El nombre es obligatorio.")
        @Size(max = 100, message = "El nombre no puede superar los 100 caracteres.")
        @Schema(description = "Nombre", example = "Ana")
        String nombre,

        @NotBlank(message = "El apellido es obligatorio.")
        @Size(max = 100, message = "El apellido no puede superar los 100 caracteres.")
        @Schema(description = "Apellido", example = "Ejemplo")
        String apellido,

        @NotBlank(message = "El teléfono es obligatorio.")
        @Pattern(regexp = "^[0-9+ ()-]{6,20}$", message = "El teléfono no tiene un formato válido.")
        @Schema(description = "Teléfono", example = "+56 9 1234 5678")
        String telefono
) {
}
