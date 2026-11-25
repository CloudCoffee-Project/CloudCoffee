package cl.cloudcoffee.auth_service.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** La persona invitada define su propia contraseña con el token del correo (INT2-109). */
@Schema(name = "ActivarCuenta")
public class ActivarCuentaRequest extends CamposDesconocidos {

    @NotBlank(message = "El token es obligatorio.")
    @Schema(description = "Token opaco del enlace de invitación.", example = "q8Yt3rU1oP0aZx9Lk2mN4bV6cX7zA5sD1fG3hJ8kL0w")
    private final String token;

    @NotBlank(message = "La contraseña es obligatoria.")
    @Size(min = 8, max = 72, message = "La contraseña debe tener entre 8 y 72 caracteres.")
    @Schema(format = "password", example = "UnaClaveSegura2026")
    private final String password;

    @JsonCreator
    public ActivarCuentaRequest(@JsonProperty("token") String token, @JsonProperty("password") String password) {
        this.token = token == null ? null : token.strip();
        this.password = password;
    }

    public String getToken() { return token; }
    public String getPassword() { return password; }

    @Override
    public String toString() {
        return "ActivarCuentaRequest[token=[REDACTED], password=[REDACTED]]";
    }
}
