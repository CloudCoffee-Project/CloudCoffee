package cl.cloudcoffee.auth_service.dto;

import cl.cloudcoffee.auth_service.model.Usuario;

public record VerificacionCorreoResponse(String email, boolean verificado) {

    public static VerificacionCorreoResponse from(Usuario usuario) {
        return new VerificacionCorreoResponse(usuario.getEmail(), usuario.isVerificado());
    }
}
