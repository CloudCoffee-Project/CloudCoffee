package cl.cloudcoffee.order_service.model;

import java.util.Locale;

public enum EstadoOrden {
    REVISION_REQUERIDA, PENDIENTE_PAGO, PAGADO, LISTO_PARA_RETIRO, ENTREGADO,
    NO_RETIRADO_PENDIENTE_REVISION, NO_RETIRADO_FINAL, CANCELADO;

    public String codigo() {
        return name().toLowerCase(Locale.ROOT);
    }
}
