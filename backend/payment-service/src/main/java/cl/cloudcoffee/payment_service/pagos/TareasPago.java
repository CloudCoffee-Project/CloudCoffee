package cl.cloudcoffee.payment_service.pagos;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

import cl.cloudcoffee.payment_service.config.PaymentProperties;
import cl.cloudcoffee.payment_service.messaging.PublicadorEventos;

/**
 * Programación de las tareas durables. Con el proveedor deshabilitado no hacen nada. Se apagan con
 * {@code PAYMENT_PROCESSING_ENABLED=false} (las pruebas invocan los servicios directamente).
 */
@Configuration(proxyBeanMethods = false)
@EnableScheduling
@ConditionalOnProperty(name = "cloudcoffee.payment.processing.enabled", havingValue = "true", matchIfMissing = true)
class TareasPago {

    private static final Logger log = LoggerFactory.getLogger(TareasPago.class);

    private final PaymentProperties properties;
    private final ProcesadorPagos procesador;
    private final PublicadorEventos publicador;

    TareasPago(PaymentProperties properties, ProcesadorPagos procesador, PublicadorEventos publicador) {
        this.properties = properties;
        this.procesador = procesador;
        this.publicador = publicador;
    }

    @Scheduled(fixedDelayString = "${cloudcoffee.payment.processing.poll-interval:PT5S}",
            initialDelayString = "${cloudcoffee.payment.processing.poll-interval:PT5S}")
    void procesarInbox() {
        ejecutar("inbox", procesador::procesarInbox);
    }

    @Scheduled(fixedDelayString = "${cloudcoffee.payment.processing.poll-interval:PT5S}",
            initialDelayString = "${cloudcoffee.payment.processing.poll-interval:PT5S}")
    void conciliar() {
        ejecutar("conciliación", procesador::conciliarIntenciones);
    }

    @Scheduled(fixedDelayString = "${cloudcoffee.payment.processing.poll-interval:PT5S}",
            initialDelayString = "${cloudcoffee.payment.processing.poll-interval:PT5S}")
    void publicar() {
        ejecutar("outbox", publicador::publicarPendientes);
    }

    private void ejecutar(String tarea, java.util.function.IntSupplier trabajo) {
        if (!properties.enabled()) return;
        try {
            // Mientras haya lotes completos, seguir (acotado para no monopolizar el hilo).
            for (int ronda = 0; ronda < 10 && trabajo.getAsInt() > 0; ronda++) {
                // continuar
            }
        } catch (RuntimeException error) {
            // Base de datos caída u otro fallo transitorio: la próxima ronda reintenta.
            log.warn("La tarea de {} falló y se reintentará: {}", tarea, error.getClass().getSimpleName());
        }
    }
}
