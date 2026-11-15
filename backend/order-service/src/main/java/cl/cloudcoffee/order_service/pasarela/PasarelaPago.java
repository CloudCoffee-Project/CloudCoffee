package cl.cloudcoffee.order_service.pasarela;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Proveedor de pagos visto desde order-service. El dominio solo conoce esta interfaz y el proveedor activo se
 * elige por configuración ({@code ORDER_PAYMENT_PROVIDER}): el simulado registra el cobro al instante; el de
 * payment-service (INT2-113) abre un checkout externo cuyo resultado llega después por eventos.
 */
public interface PasarelaPago {

    /** Identificador estable del proveedor; se guarda en cada pago. */
    String proveedor();

    /** Proveedor simulado: registra un cobro por el monto calculado en el servidor y devuelve su referencia. */
    RegistroPasarela registrar(SolicitudPago solicitud);

    /** true si el proveedor abre un checkout externo (y entonces no usa {@link #registrar}). */
    default boolean esExterna() {
        return false;
    }

    /**
     * Crea (o recupera) el checkout de una compra. Idempotente: la misma clave y carga nunca crean un segundo
     * checkout, también entre réplicas o tras un reinicio. Nunca se llama dentro de una transacción.
     */
    default Inicio iniciarCheckout(SolicitudCheckout solicitud) {
        throw new UnsupportedOperationException("El proveedor " + proveedor() + " no abre checkouts externos");
    }

    /** Estado actual del checkout de la compra, sin efectos en el proveedor. */
    default Consulta consultarCheckout(UUID compraId) {
        throw new UnsupportedOperationException("El proveedor " + proveedor() + " no abre checkouts externos");
    }

    record SolicitudPago(UUID compraId, BigDecimal monto) {
    }

    record RegistroPasarela(String referencia) {
    }

    /** Carga JSON ya congelada y su clave de idempotencia estable. */
    record SolicitudCheckout(UUID claveIdempotencia, String cuerpo) {
    }

    /** Proyección de la intención en el proveedor (paymentId, preferencia, checkout, estado y versión). */
    record Checkout(UUID paymentId, UUID compraId, UUID clienteId, String preferenciaId, String initPoint,
            String estado, long montoTotal, long version) {
    }

    sealed interface Inicio permits CheckoutListo, CheckoutPendiente, CheckoutRechazado {
    }

    /** Checkout creado o recuperado con su URL. */
    record CheckoutListo(Checkout checkout) implements Inicio {
    }

    /** Resultado ambiguo o proveedor no disponible: reintentar con la misma clave. */
    record CheckoutPendiente(String codigo) implements Inicio {
    }

    /** Rechazo definitivo (por ejemplo RESERVA_VENCIDA): no reintentar. */
    record CheckoutRechazado(String codigo) implements Inicio {
    }

    sealed interface Consulta permits CheckoutEncontrado, CheckoutInexistente, ConsultaNoDisponible {
    }

    record CheckoutEncontrado(Checkout checkout) implements Consulta {
    }

    record CheckoutInexistente() implements Consulta {
    }

    record ConsultaNoDisponible(String motivo) implements Consulta {
    }
}
