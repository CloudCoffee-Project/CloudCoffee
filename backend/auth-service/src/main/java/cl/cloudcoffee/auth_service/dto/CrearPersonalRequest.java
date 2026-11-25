package cl.cloudcoffee.auth_service.dto;

import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** Alta de personal por invitación (INT2-109). No admite contraseña: la define la persona al activar. */
@Schema(name = "CrearPersonal")
public class CrearPersonalRequest extends CamposDesconocidos {

    @NotBlank(message = "El correo es obligatorio.")
    @Email(message = "El correo debe ser válido.")
    @Size(max = 150, message = "El correo no puede superar los 150 caracteres.")
    @Schema(example = "cajera.nueva@uct.cl", format = "email")
    private final String email;

    @NotBlank(message = "El nombre es obligatorio.")
    @Size(max = 100, message = "El nombre no puede superar los 100 caracteres.")
    @Schema(example = "Ana")
    private final String nombre;

    @NotBlank(message = "El apellido es obligatorio.")
    @Size(max = 100, message = "El apellido no puede superar los 100 caracteres.")
    @Schema(example = "Pérez")
    private final String apellido;

    @NotBlank(message = "El teléfono es obligatorio.")
    @Pattern(regexp = "^[0-9+ ()-]{6,20}$", message = "El teléfono no tiene un formato válido.")
    @Schema(example = "+56912345678")
    private final String telefono;

    @NotNull(message = "El rol es obligatorio.")
    @Pattern(regexp = "CAJERO|ADMIN_CAFETERIA", message = "El rol debe ser CAJERO o ADMIN_CAFETERIA.")
    @Schema(allowableValues = {"CAJERO", "ADMIN_CAFETERIA"}, example = "CAJERO")
    private final String rol;

    @Schema(description = "Obligatorio para SUPER_ADMIN.", example = "44444444-4444-4444-8444-444444444444")
    private final UUID cafeteriaId;

    @JsonCreator
    public CrearPersonalRequest(@JsonProperty("email") String email, @JsonProperty("nombre") String nombre,
            @JsonProperty("apellido") String apellido, @JsonProperty("telefono") String telefono,
            @JsonProperty("rol") String rol, @JsonProperty("cafeteriaId") UUID cafeteriaId) {
        this.email = recortar(email);
        this.nombre = recortar(nombre);
        this.apellido = recortar(apellido);
        this.telefono = recortar(telefono);
        this.rol = rol;
        this.cafeteriaId = cafeteriaId;
    }

    public String getEmail() { return email; }
    public String getNombre() { return nombre; }
    public String getApellido() { return apellido; }
    public String getTelefono() { return telefono; }
    public String getRol() { return rol; }
    public UUID getCafeteriaId() { return cafeteriaId; }
}
