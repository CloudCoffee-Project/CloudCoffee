package cl.cloudcoffee.notification_service.history;

import cl.cloudcoffee.notification_service.messaging.CloudCoffeeEvent;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;

import java.util.UUID;

@Service
public class NotificationHistoryService {

    private final NotificationHistoryRepository repository;

    public NotificationHistoryService(NotificationHistoryRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public boolean wasSuccessful(UUID eventId) {
        return repository.existsByEventIdAndStatus(eventId, "SUCCESS");
    }

    @Transactional
    public void registerSuccess(CloudCoffeeEvent event) {
        repository.findByEventId(event.eventId()).ifPresentOrElse(
                NotificationHistory::markSuccess,
                () -> repository.save(new NotificationHistory(event.eventId(), event.eventType(),
                        event.traceId(), event.payload(), "SUCCESS")));
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void registerFailure(CloudCoffeeEvent event, String errorDetail) {
        Object token = event.payload().get("token");
        if (token instanceof String value && !value.isEmpty() && errorDetail != null) {
            errorDetail = errorDetail.replace(value, "[REDACTED]");
        }
        // Truncar el detalle del error en caso de que sea muy largo
        if (errorDetail != null && errorDetail.length() > 1000) {
            errorDetail = errorDetail.substring(0, 997) + "...";
        }
        String safeDetail = errorDetail;
        repository.findByEventId(event.eventId()).ifPresentOrElse(
                history -> history.markFailure(safeDetail),
                () -> repository.save(new NotificationHistory(event.eventId(), event.eventType(),
                        event.traceId(), event.payload(), "FAILED", safeDetail)));
    }
}
