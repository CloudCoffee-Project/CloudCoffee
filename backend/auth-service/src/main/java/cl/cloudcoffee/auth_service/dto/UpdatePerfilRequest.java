package cl.cloudcoffee.auth_service.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record UpdatePerfilRequest(
    @Size(max = 100, message = "El nombre no puede sueprar los 100 caracteres.")
    @Schema(description = "Nombre", example = "Ana")
    String nombre,

    @Size(max = 100, message = "El apellido no puede superar los 100 caracteres.")
    @Schema(description = "Apellido", example = "Ejemplo")
    String apellido,

    @Pattern(regexp = "^[0-9+ ()-]{6,20}$", message = "El telefono no tiene un formato valido.")
    @Schema(description = "Teléfono", example = "+56 9 1234 5678")
    String telefono
){
}
