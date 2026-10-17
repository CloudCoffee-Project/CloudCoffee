package cl.cloudcoffee.order_service.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Revisa periódicamente las reservas vencidas (cada minuto por defecto). */
@Component
@ConditionalOnProperty(name = "cloudcoffee.reservas.expiracion.enabled", havingValue = "true", matchIfMissing = true)
public class ExpiracionReservasJob {

    private static final Logger LOGGER = LoggerFactory.getLogger(ExpiracionReservasJob.class);

    private final ExpiracionReservasService expiracion;

    public ExpiracionReservasJob(ExpiracionReservasService expiracion) {
        this.expiracion = expiracion;
    }

    @Scheduled(fixedDelayString = "${cloudcoffee.reservas.expiracion.intervalo:PT1M}")
    public void expirarVencidas() {
        for (var compraId : expiracion.comprasVencidas()) {
            try {
                expiracion.expirarCompra(compraId);
            } catch (RuntimeException exception) {
                LOGGER.error("No se pudo expirar la compra {}", compraId, exception);
            }
        }
    }
}
