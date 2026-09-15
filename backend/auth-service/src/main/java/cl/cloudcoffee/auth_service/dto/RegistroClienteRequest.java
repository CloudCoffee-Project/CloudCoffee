package cl.cloudcoffee.auth_service.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record RegistroClienteRequest(

        @NotBlank(message = "El correo es obligatorio.")
        @Email(message = "El correo debe ser válido.")
        String email,

        @NotBlank(message = "La contraseña es obligatoria.")
        @Size(min = 8, message = "La contraseña debe tener al menos 8 caracteres.")
        String password,

        @NotBlank(message = "El nombre es obligatorio.")
        @Size(max = 100, message = "El nombre no puede superar los 100 caracteres.")
        String nombre,

        @NotBlank(message = "El apellido es obligatorio.")
        @Size(max = 100, message = "El apellido no puede superar los 100 caracteres.")
        String apellido,

        @NotBlank(message = "El teléfono es obligatorio.")
        @Pattern(regexp = "^[0-9+ ()-]{6,20}$", message = "El teléfono no tiene un formato válido.")
        String telefono
) {
}
