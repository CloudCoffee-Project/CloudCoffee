package cl.cloudcoffee.notification_service.push;

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
@Table(name = "notification_push_delivery")
public class NotificationPushDelivery {

    @Id
    private UUID id;

    @Column(name = "event_id", nullable = false)
    private UUID eventId;

    @Column(name = "channel", nullable = false, length = 20)
    private String channel;

    @Column(name = "device_token_id", nullable = false)
    private UUID deviceTokenId;

    @Column(name = "title", nullable = false, length = 120)
    private String title;

    @Column(name = "body", nullable = false, length = 240)
    private String body;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "data", nullable = false, columnDefinition = "json")
    private Map<String, String> data;

    @Column(name = "status", nullable = false, length = 20)
    private String status;

    @Column(name = "attempt_count", nullable = false)
    private int attemptCount;

    @Column(name = "next_attempt_at", nullable = false)
    private Instant nextAttemptAt;

    @Column(name = "last_error", length = 100)
    private String lastError;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected NotificationPushDelivery() {
    }

    public NotificationPushDelivery(UUID id, UUID eventId, UUID deviceTokenId,
            String title, String body, Map<String, String> data, Instant now) {
        this.id = id;
        this.eventId = eventId;
        this.channel = "FCM";
        this.deviceTokenId = deviceTokenId;
        this.title = title;
        this.body = body;
        this.data = Map.copyOf(data);
        this.status = "PENDING";
        this.attemptCount = 0;
        this.nextAttemptAt = now;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public boolean isPending() {
        return "PENDING".equals(status);
    }

    public boolean isDue(Instant now) {
        return isPending() && !nextAttemptAt.isAfter(now);
    }

    public void beginAttempt() {
        attemptCount++;
        updatedAt = Instant.now();
    }

    public void markSent() {
        status = "SENT";
        lastError = null;
        updatedAt = Instant.now();
    }

    public void scheduleRetry(Instant retryAt, String errorCode) {
        nextAttemptAt = retryAt;
        lastError = errorCode;
        updatedAt = Instant.now();
    }

    public void markFailed(String errorCode) {
        status = "FAILED";
        lastError = errorCode;
        updatedAt = Instant.now();
    }

    public UUID getId() {
        return id;
    }

    public UUID getEventId() {
        return eventId;
    }

    public UUID getDeviceTokenId() {
        return deviceTokenId;
    }

    public String getTitle() {
        return title;
    }

    public String getBody() {
        return body;
    }

    public Map<String, String> getData() {
        return data;
    }

    public int getAttemptCount() {
        return attemptCount;
    }

    public String getStatus() {
        return status;
    }
}
