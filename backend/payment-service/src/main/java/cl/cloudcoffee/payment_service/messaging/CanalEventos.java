package cl.cloudcoffee.payment_service.messaging;

import java.util.UUID;

/** Envío de un evento ya serializado. Solo cuenta como entregado si el broker lo confirmó y lo enrutó. */
public interface CanalEventos {

    Envio enviar(String exchange, String routingKey, UUID eventId, String cuerpo, String motivoDlq);

    /** {@code codigo} explica el fallo (BROKER_NO_DISPONIBLE, SIN_CONFIRMACION, RECHAZADO, SIN_RUTA). */
    record Envio(boolean confirmado, String codigo) {
        public static Envio ok() {
            return new Envio(true, null);
        }

        public static Envio fallo(String codigo) {
            return new Envio(false, codigo);
        }
    }
}
