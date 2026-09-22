package cl.cloudcoffee.notification_service.history;

import cl.cloudcoffee.notification_service.messaging.CloudCoffeeEvent;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NotificationHistoryService {

    private final NotificationHistoryRepository repository;

    public NotificationHistoryService(NotificationHistoryRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public void register(CloudCoffeeEvent event) {
        if (repository.existsByEventId(event.eventId())) {
            return;
        }

        String trackingId = event.traceId();

        repository.save(new NotificationHistory(
                event.eventId(),
                event.eventType(),
                trackingId,
                event.payload(),
                "RECEIVED"
        ));
    }
}
