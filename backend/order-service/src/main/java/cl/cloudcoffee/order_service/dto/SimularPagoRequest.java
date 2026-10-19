package cl.cloudcoffee.order_service.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;

import cl.cloudcoffee.order_service.model.EscenarioPago;
import jakarta.validation.constraints.NotNull;

/**
 * Contrato INT2-50: el comando admite solo {@code escenario}. Cualquier otro campo
 * (tarjeta, importe, estado...) hace fallar la lectura del cuerpo y responde 400;
 * Spring Boot desactiva el fallo por propiedades desconocidas, así que se fuerza aquí.
 */
public class SimularPagoRequest {

    @NotNull(message = "El escenario es obligatorio.")
    private EscenarioPago escenario;

    public EscenarioPago getEscenario() {
        return escenario;
    }

    public void setEscenario(EscenarioPago escenario) {
        this.escenario = escenario;
    }

    @JsonAnySetter
    void rechazarCampoDesconocido(String campo, Object valor) {
        throw new IllegalArgumentException("Campo no admitido: " + campo);
    }
}
