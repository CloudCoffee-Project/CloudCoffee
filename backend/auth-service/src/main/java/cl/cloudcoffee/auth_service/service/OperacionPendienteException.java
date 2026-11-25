package cl.cloudcoffee.auth_service.service;

/**
 * Una dependencia necesaria para decidir no respondió (contrato INT2-109): 503 OPERACION_PENDIENTE,
 * sin cambios. Se reintenta la misma solicitud.
 */
public class OperacionPendienteException extends RuntimeException {

    public OperacionPendienteException(String detalle) {
        super(detalle);
    }
}
