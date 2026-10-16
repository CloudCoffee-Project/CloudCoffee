package cl.cloudcoffee.order_service.dto;

import cl.cloudcoffee.order_service.model.EscenarioPago;
import jakarta.validation.constraints.NotNull;

/** Solo el escenario: la simulación no pide tarjeta ni importe. */
public record SimulacionPagoRequest(
        @NotNull(message = "El escenario es obligatorio.")
        EscenarioPago escenario
) {
}
