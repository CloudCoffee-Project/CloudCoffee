package cl.cloudcoffee.payment_service.preferencias;

/**
 * 503 de Payment: proveedor deshabilitado, no disponible o resultado ambiguo en conciliación.
 * BusinessException solo admite 4xx, por eso se publica con su propio manejador.
 */
public class PagoNoDisponibleException extends RuntimeException {

    private final String code;
    private final Integer retryAfter;

    public PagoNoDisponibleException(String code, String detail, Integer retryAfter) {
        super(detail);
        this.code = code;
        this.retryAfter = retryAfter;
    }

    public String getCode() {
        return code;
    }

    public Integer getRetryAfter() {
        return retryAfter;
    }
}
