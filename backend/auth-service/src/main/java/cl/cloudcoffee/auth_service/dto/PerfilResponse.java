package cl.cloudcoffee.auth_service.dto;

import java.util.UUID;

import cl.cloudcoffee.auth_service.model.Rol;

public record PerfilResponse(
    UUID id,
    String email,
    String nombre,
    String apellido,
    String telefono,
    Rol rol
) {
}
