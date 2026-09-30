package cl.cloudcoffee.auth_service.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.UUID;

import cl.cloudcoffee.auth_service.model.Rol;

public record PerfilResponse(
    @Schema(description = "Identificador del usuario", example = "11111111-1111-4111-8111-111111111111", format = "uuid")
    UUID id,
    @Schema(description = "Correo electrónico", example = "cliente@example.com", format = "email")
    String email,
    @Schema(description = "Nombre", example = "Ana")
    String nombre,
    @Schema(description = "Apellido", example = "Ejemplo")
    String apellido,
    @Schema(description = "Teléfono", example = "+56 9 1234 5678")
    String telefono,
    @Schema(description = "Rol del usuario", example = "CLIENTE")
    Rol rol
) {
}
