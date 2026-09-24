package cl.cloudcoffee.notification_service.messaging;

import cl.cloudcoffee.notification_service.history.NotificationHistoryService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class NotificationEventConsumer {

    private static final Logger LOGGER = LoggerFactory.getLogger(NotificationEventConsumer.class);

    private final NotificationHistoryService historyService;

    public NotificationEventConsumer(
            NotificationHistoryService historyService
    ) {
        this.historyService = historyService;
    }

    @Transactional
    @RabbitListener(
            queues = RabbitTopologyConfig.NOTIFICATION_EVENTS_QUEUE
    )
    public void consume(CloudCoffeeEvent event) {
        validate(event);

        if (historyService.existsByEventId(event.eventId())) {
            LOGGER.info("Evento ya procesado (idempotencia): eventId={}, traceId={}", event.eventId(), event.traceId());
            return;
        }

        LOGGER.info("Procesando evento {}: eventId={}, traceId={}", event.eventType(), event.eventId(), event.traceId());

        switch (event.eventType()) {
            case "SolicitudVerificacionCorreo":
                procesarVerificacionCorreo(event);
                break;
            case "SolicitudRecuperacionPassword":
                procesarRecuperacionPassword(event);
                break;
            default:
                LOGGER.info("Tipo de evento no manejado por este consumidor: {}", event.eventType());
                break;
        }

        historyService.register(event);
    }

    private void procesarVerificacionCorreo(CloudCoffeeEvent event) {
        String email = (String) event.payload().get("email");
        String token = (String) event.payload().get("token");
        LOGGER.info("-> Simulando envío de correo de VERIFICACIÓN a {}. Token: {}", email, token);
    }

    private void procesarRecuperacionPassword(CloudCoffeeEvent event) {
        String email = (String) event.payload().get("email");
        String token = (String) event.payload().get("token");
        LOGGER.info("-> Simulando envío de correo de RECUPERACIÓN a {}. Token: {}", email, token);
    }

    private void validate(CloudCoffeeEvent event) {
        if (event == null
                || event.eventId() == null
                || event.timestamp() == null
                || event.traceId() == null
                || event.traceId().isBlank()
                || event.eventType() == null
                || event.eventType().isBlank()
                || event.payload() == null) {
            throw new IllegalArgumentException(
                    "El evento no contiene los datos obligatorios"
            );
        }
    }
}
