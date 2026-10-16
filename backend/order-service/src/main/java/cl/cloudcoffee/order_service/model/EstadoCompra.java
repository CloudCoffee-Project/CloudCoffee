package cl.cloudcoffee.order_service.model;

/** Estado de la compra según el resultado de su pago. Solo PENDIENTE_PAGO admite cambios. */
public enum EstadoCompra {
    PENDIENTE_PAGO,
    PAGADA,
    RECHAZADA,
    EXPIRADA
}
