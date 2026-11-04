package cl.cloudcoffee.order_service.model;

import java.util.Locale;

/** Estados estables del contrato INT2-50; reservando es una operación interna. */
public enum EstadoCompra {
    REVISION_REQUERIDA, PENDIENTE_PAGO, PAGADO, CANCELADO;

    public String codigo() {
        return name().toLowerCase(Locale.ROOT);
    }
}
