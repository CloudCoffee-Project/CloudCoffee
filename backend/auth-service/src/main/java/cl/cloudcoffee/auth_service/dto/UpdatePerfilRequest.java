package cl.cloudcoffee.auth_service.dto;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record UpdatePerfilRequest(
    @Size(max = 100, message = "El nombre no puede sueprar los 100 caracteres.")
    String nombre,

    @Size(max = 100, message = "El apellido no puede superar los 100 caracteres.")
    String apellido,

    @Pattern(regexp = "^[0-9+ ()-]{6,20}$", message = "El telefono no tiene un formato valido.")
    String telefono
){
}
