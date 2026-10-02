package cl.cloudcoffee.auth_service.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import cl.cloudcoffee.auth_service.model.Usuario;

public record VerificacionCorreoResponse(
        @Schema(description = "Correo electrónico", example = "cliente@example.com", format = "email")
        String email,
        @Schema(description = "Correo verificado", example = "false")
        boolean verificado
) {

    public static VerificacionCorreoResponse from(Usuario usuario) {
        return new VerificacionCorreoResponse(usuario.getEmail(), usuario.isVerificado());
    }
}
