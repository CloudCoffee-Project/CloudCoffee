package cl.cloudcoffee.order_service.model;

/** Resultado que fuerza la simulación: el mismo escenario produce siempre el mismo estado. */
public enum EscenarioPago {
    PENDIENTE(EstadoPago.PENDIENTE),
    APROBADO(EstadoPago.APROBADO),
    RECHAZADO(EstadoPago.RECHAZADO);

    public static final String MOTIVO_RECHAZO = "Pago rechazado por la simulación.";

    private final EstadoPago estadoResultante;

    EscenarioPago(EstadoPago estadoResultante) {
        this.estadoResultante = estadoResultante;
    }

    public EstadoPago estadoResultante() {
        return estadoResultante;
    }
}
