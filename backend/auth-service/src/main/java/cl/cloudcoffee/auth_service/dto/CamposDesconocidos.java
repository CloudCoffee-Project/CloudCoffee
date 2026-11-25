package cl.cloudcoffee.auth_service.dto;

import java.util.LinkedHashMap;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonIgnore;

import jakarta.validation.constraints.AssertTrue;

/**
 * Cuerpos administrativos del contrato INT2-109 con {@code additionalProperties: false}: un campo
 * extra (por ejemplo {@code password} en un alta o {@code rol} en una edición) es 400, nunca se ignora.
 */
public abstract class CamposDesconocidos {

    private final Map<String, Object> desconocidos = new LinkedHashMap<>();

    @JsonAnySetter
    void desconocido(String campo, Object valor) {
        desconocidos.put(campo, valor);
    }

    @JsonIgnore
    @AssertTrue(message = "El cuerpo contiene campos no admitidos.")
    public boolean isSinCamposDesconocidos() {
        return desconocidos.isEmpty();
    }

    static String recortar(String valor) {
        return valor == null ? null : valor.strip();
    }
}
