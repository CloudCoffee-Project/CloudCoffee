package cl.cloudcoffee.order_service.pasarela;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Proveedor de pagos visto desde order-service. El dominio solo conoce esta
 * interfaz, así que cambiar el proveedor simulado por uno real no toca el modelo.
 */
public interface PasarelaPago {

    /** Identificador estable del proveedor; se guarda en cada pago. */
    String proveedor();

    /** Registra un cobro por el monto calculado en el servidor y devuelve su referencia. */
    RegistroPasarela registrar(SolicitudPago solicitud);

    record SolicitudPago(UUID compraId, BigDecimal monto) {
    }

    record RegistroPasarela(String referencia) {
    }
}
