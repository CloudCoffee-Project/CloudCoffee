package cl.cloudcoffee.notification_service.messaging;

import cl.cloudcoffee.notification_service.history.NotificationHistoryService;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
public class NotificationEventConsumer {

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
