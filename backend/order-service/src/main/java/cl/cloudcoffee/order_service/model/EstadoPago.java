package cl.cloudcoffee.order_service.model;

/**
 * Estados de un pago. PENDIENTE pasa a APROBADO, RECHAZADO o REQUIERE_CONCILIACION. Los dos primeros son
 * finales para el cumplimiento, pero un resultado externo posterior (aprobación tardía, doble aprobación,
 * reembolso) todavía puede llevarlos a REQUIERE_CONCILIACION, que es final y se resuelve manualmente.
 */
public enum EstadoPago {
    PENDIENTE,
    APROBADO,
    RECHAZADO,
    /** INT2-113: resultado externo que no puede aplicarse automáticamente; bloquea nuevo cumplimiento. */
    REQUIERE_CONCILIACION;

    public boolean esFinal() {
        return this != PENDIENTE;
    }

    public boolean puedeTransicionarA(EstadoPago destino) {
        if (destino == null || destino == this) return false;
        if (this == PENDIENTE) return destino.esFinal();
        return this != REQUIERE_CONCILIACION && destino == REQUIERE_CONCILIACION;
    }
}
