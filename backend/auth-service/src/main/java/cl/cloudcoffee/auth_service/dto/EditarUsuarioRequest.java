package cl.cloudcoffee.auth_service.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** Datos de contacto; los campos omitidos se conservan. El email y el rol no se editan. */
@Schema(name = "EditarUsuario")
public class EditarUsuarioRequest extends CamposDesconocidos {

    @Size(min = 1, max = 100, message = "El nombre debe tener entre 1 y 100 caracteres.")
    private final String nombre;

    @Size(min = 1, max = 100, message = "El apellido debe tener entre 1 y 100 caracteres.")
    private final String apellido;

    @Pattern(regexp = "^[0-9+ ()-]{6,20}$", message = "El teléfono no tiene un formato válido.")
    private final String telefono;

    @NotNull(message = "La versión es obligatoria.")
    @Min(value = 1, message = "La versión debe ser mayor o igual a 1.")
    @Schema(description = "Versión optimista; se envía la última leída.", example = "1")
    private final Long version;

    @JsonCreator
    public EditarUsuarioRequest(@JsonProperty("nombre") String nombre, @JsonProperty("apellido") String apellido,
            @JsonProperty("telefono") String telefono, @JsonProperty("version") Long version) {
        this.nombre = recortar(nombre);
        this.apellido = recortar(apellido);
        this.telefono = recortar(telefono);
        this.version = version;
    }

    public String getNombre() { return nombre; }
    public String getApellido() { return apellido; }
    public String getTelefono() { return telefono; }
    public Long getVersion() { return version; }
}
