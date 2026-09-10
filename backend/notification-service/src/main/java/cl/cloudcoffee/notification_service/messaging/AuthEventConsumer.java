package cl.cloudcoffee.notification_service.messaging;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
public class AuthEventConsumer {

    private static final Logger LOGGER =
            LoggerFactory.getLogger(AuthEventConsumer.class);

    @RabbitListener(
            queues = RabbitTopologyConfig.NOTIFICATION_EVENTS_QUEUE
    )
    public void consume(CloudCoffeeEvent event) {
        validate(event);

        LOGGER.info(
                "Evento de Auth consumido: eventId={}, eventType={}, traceId={}, payload={}",
                event.eventId(),
                event.eventType(),
                event.traceId(),
                event.payload()
        );
    }

    private void validate(CloudCoffeeEvent event) {
        if (event.eventId() == null
                || event.timestamp() == null
                || event.traceId() == null
                || event.traceId().isBlank()) {
            throw new IllegalArgumentException(
                    "El evento no contiene los metadatos obligatorios"
            );
        }
    }
}