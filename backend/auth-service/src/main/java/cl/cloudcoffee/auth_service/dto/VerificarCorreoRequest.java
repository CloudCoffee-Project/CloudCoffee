package cl.cloudcoffee.auth_service.dto;

import jakarta.validation.constraints.NotBlank;

public record VerificarCorreoRequest(
        @NotBlank(message = "El token es obligatorio.")
        String token
) {
}
