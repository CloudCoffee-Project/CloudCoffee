package cl.cloudcoffee.order_service.service;

/**
 * 503 del pago con payment-service: resultado ambiguo o proveedor no disponible. El cliente reintenta con la
 * misma Idempotency-Key tras {@code Retry-After}. BusinessException solo admite 4xx.
 */
public class PagoNoDisponibleException extends RuntimeException {

    private final String code;

    public PagoNoDisponibleException(String code, String detail) {
        super(detail);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
