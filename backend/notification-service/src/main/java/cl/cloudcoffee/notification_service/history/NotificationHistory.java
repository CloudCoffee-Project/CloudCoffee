package cl.cloudcoffee.notification_service.history;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@Entity
@Table(name = "notification_history")
public class NotificationHistory {
    @Id
    private UUID id;

    @Column(name = "event_id", nullable = false, unique = true)
    private UUID eventId;

    @Column(name = "event_type", nullable = false, length = 120)
    private String eventType;

    @Column(name = "tracking_id", nullable = false, length = 120)
    private String trackingId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "payload", nullable = false, columnDefinition = "json")
    private Map<String, Object> payload;

    @Column(name = "status", nullable = false, length = 30)
    private String status;

    @Column(name = "error_detail", length = 1000)
    private String errorDetail;

    @Column(name = "processed_at", nullable = false)
    private Instant processedAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected NotificationHistory() {
    }

    public NotificationHistory(
            UUID eventId,
            String eventType,
            String trackingId,
            Map<String, Object> payload,
            String status
    ) {
        this.id = UUID.randomUUID();
        this.eventId = eventId;
        this.eventType = eventType;
        this.trackingId = trackingId;
        this.payload = payload;
        this.status = status;
        this.processedAt = Instant.now();
        this.createdAt = Instant.now();
    }

    public UUID getId() {
        return id;
    }

    public UUID getEventId() {
        return eventId;
    }

    public String getEventType() {
        return eventType;
    }

    public String getTrackingId() {
        return trackingId;
    }

    public Map<String, Object> getPayload() {
        return payload;
    }

    public String getStatus() {
        return status;
    }

    public String getErrorDetail() {
        return errorDetail;
    }

    public Instant getProcessedAt() {
        return processedAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
