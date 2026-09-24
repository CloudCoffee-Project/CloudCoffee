package cl.cloudcoffee.notification_service.messaging;

import cl.cloudcoffee.notification_service.history.NotificationHistoryService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
public class NotificationEventConsumer {

    private static final Logger LOGGER =
            LoggerFactory.getLogger(NotificationEventConsumer.class);

    private final NotificationHistoryService historyService;

    public NotificationEventConsumer(
            NotificationHistoryService historyService
    ) {
        this.historyService = historyService;
    }

    @RabbitListener(
            queues = RabbitTopologyConfig.NOTIFICATION_EVENTS_QUEUE
    )
    public void consume(CloudCoffeeEvent event) {
        validate(event);
        historyService.register(event);
        LOGGER.info("Evento consumido: eventId={}, eventType={}, traceId={}",
                event.eventId(), event.eventType(), event.traceId());
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
