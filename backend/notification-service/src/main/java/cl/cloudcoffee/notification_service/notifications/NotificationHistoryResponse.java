package cl.cloudcoffee.notification_service.notifications;

import cl.cloudcoffee.notification_service.history.NotificationHistory;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record NotificationHistoryResponse(UUID id, UUID eventId, String eventType, String trackingId,
        Map<String, Object> payload, String status, String errorDetail, Instant processedAt, Instant createdAt) {

    public static NotificationHistoryResponse from(NotificationHistory history) {
        String errorDetail = history.getErrorDetail();
        Object token = history.getPayload().get("token");
        if (errorDetail != null && token instanceof String value && !value.isEmpty()) {
            errorDetail = errorDetail.replace(value, "[REDACTED]");
        }
        return new NotificationHistoryResponse(history.getId(), history.getEventId(), history.getEventType(),
                history.getTrackingId(), NotificationHistory.sanitizedPayload(history.getPayload()),
                history.getStatus(), errorDetail, history.getProcessedAt(), history.getCreatedAt());
    }
}
