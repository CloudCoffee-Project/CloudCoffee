package cl.cloudcoffee.auth_service.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Confirmación de identidad para la baja propia (INT2-129). No admite el id de otro usuario ni otros campos. */
@Schema(name = "BajaPropia")
public class BajaPropiaRequest extends CamposDesconocidos {

    @NotBlank(message = "La contraseña actual es obligatoria.")
    @Size(max = 72, message = "La contraseña no puede superar los 72 caracteres.")
    @Schema(format = "password", example = "MiClaveActual1")
    private final String passwordActual;

    @JsonCreator
    public BajaPropiaRequest(@JsonProperty("passwordActual") String passwordActual) {
        this.passwordActual = passwordActual;
    }

    public String getPasswordActual() { return passwordActual; }

    @Override
    public String toString() {
        return "BajaPropiaRequest[passwordActual=[REDACTED]]";
    }
}
