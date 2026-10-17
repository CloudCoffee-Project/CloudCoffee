package cl.cloudcoffee.order_service.model;

/** Cambio de estado no permitido para un pago. */
public class TransicionPagoInvalidaException extends RuntimeException {

    private final EstadoPago origen;
    private final EstadoPago destino;

    public TransicionPagoInvalidaException(EstadoPago origen, EstadoPago destino) {
        super("Transición de pago no permitida: " + origen + " -> " + destino);
        this.origen = origen;
        this.destino = destino;
    }

    public EstadoPago getOrigen() { return origen; }
    public EstadoPago getDestino() { return destino; }
}
