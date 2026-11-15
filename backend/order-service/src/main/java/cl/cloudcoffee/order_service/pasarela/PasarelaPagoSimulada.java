package cl.cloudcoffee.order_service.pasarela;

import java.util.UUID;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Proveedor de prueba: no mueve dinero. Solo entrega una referencia propia; la simulación del resultado del
 * pago y su consulta llegan con INT2-76. Es el proveedor por defecto ({@code ORDER_PAYMENT_PROVIDER=simulado}).
 */
@Component
@ConditionalOnProperty(name = "cloudcoffee.pagos.provider", havingValue = "simulado", matchIfMissing = true)
public class PasarelaPagoSimulada implements PasarelaPago {

    public static final String PROVEEDOR = "SIMULADO";

    @Override
    public String proveedor() {
        return PROVEEDOR;
    }

    @Override
    public RegistroPasarela registrar(SolicitudPago solicitud) {
        return new RegistroPasarela("SIM-" + UUID.randomUUID());
    }
}
