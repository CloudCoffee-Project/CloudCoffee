package cl.cloudcoffee.auth_service.dto;

import java.util.UUID;

import cl.cloudcoffee.auth_service.model.Rol;
import cl.cloudcoffee.auth_service.model.Usuario;

public record RegistroClienteResponse(
        UUID id,
        String email,
        String nombre,
        String apellido,
        String telefono,
        Rol rol,
        boolean verificado
) {

    public static RegistroClienteResponse from(Usuario usuario) {
        return new RegistroClienteResponse(
                usuario.getId(),
                usuario.getEmail(),
                usuario.getNombre(),
                usuario.getApellido(),
                usuario.getTelefono(),
                usuario.getRol(),
                usuario.isVerificado()
        );
    }
}
