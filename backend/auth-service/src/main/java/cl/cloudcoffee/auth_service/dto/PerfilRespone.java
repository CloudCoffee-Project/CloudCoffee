package cl.cloudcoffee.auth_service.dto;

import cl.cloudcoffee.auth_service.model.Rol;

public record PerfilRespone(
    Long id,
    String email,
    String nombre,
    String apellido,
    String telefono,
    Rol rol
) {
}
