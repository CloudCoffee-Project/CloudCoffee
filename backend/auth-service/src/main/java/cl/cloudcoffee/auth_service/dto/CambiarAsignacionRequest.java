package cl.cloudcoffee.auth_service.dto;

import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

@Schema(name = "CambiarAsignacion")
public class CambiarAsignacionRequest extends CamposDesconocidos {

    @NotNull(message = "La cafetería es obligatoria.")
    private final UUID cafeteriaId;

    @NotNull(message = "La versión es obligatoria.")
    @Min(value = 1, message = "La versión debe ser mayor o igual a 1.")
    private final Long version;

    @JsonCreator
    public CambiarAsignacionRequest(@JsonProperty("cafeteriaId") UUID cafeteriaId,
            @JsonProperty("version") Long version) {
        this.cafeteriaId = cafeteriaId;
        this.version = version;
    }

    public UUID getCafeteriaId() { return cafeteriaId; }
    public Long getVersion() { return version; }
}
