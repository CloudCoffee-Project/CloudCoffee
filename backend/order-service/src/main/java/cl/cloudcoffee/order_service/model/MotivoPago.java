package cl.cloudcoffee.order_service.model;

import java.util.Locale;

/** Motivo del estado del pago según el contrato de INT2-50; la API lo expone en snake_case. */
public enum MotivoPago {
    APROBACION_SIMULADA,
    RECHAZO_SIMULADO,
    ESCENARIO_PENDIENTE,
    PROCESANDO_STOCK,
    RESERVA_VENCIDA,
    COMPRA_CANCELADA;

    public String codigo() {
        return name().toLowerCase(Locale.ROOT);
    }
}
