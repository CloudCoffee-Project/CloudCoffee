package cl.cloudcoffee.order_service.model;

/**
 * Estados de un pago. Solo PENDIENTE admite cambios: pasa a APROBADO o RECHAZADO,
 * y ambos son finales.
 */
public enum EstadoPago {
    PENDIENTE,
    APROBADO,
    RECHAZADO;

    public boolean esFinal() {
        return this != PENDIENTE;
    }

    public boolean puedeTransicionarA(EstadoPago destino) {
        return this == PENDIENTE && destino != null && destino.esFinal();
    }
}
