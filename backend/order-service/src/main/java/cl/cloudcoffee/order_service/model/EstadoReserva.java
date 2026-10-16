package cl.cloudcoffee.order_service.model;

/** ACTIVA retiene stock; CONFIRMADA lo consume (pago aprobado); LIBERADA lo devuelve. */
public enum EstadoReserva {
    ACTIVA,
    CONFIRMADA,
    LIBERADA
}
