package cl.cloudcoffee.notification_service.history;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

@Entity
@Table(name = "notification_history")
public class NotificationHistory {
    private static final Pattern LABELED_CREDENTIAL = Pattern.compile(
            "(?i)(token|password|secret|credential|authorization|api[_-]?key|private[_-]?key)(\\s*[=:]\\s*)[^\\s,;]+");
    private static final Pattern BEARER_TOKEN = Pattern.compile("(?i)\\bBearer\\s+[A-Za-z0-9._~+/-]+=*");

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
            String status,
            String errorDetail
    ) {
        this.id = UUID.randomUUID();
        this.eventId = eventId;
        this.eventType = eventType;
        this.trackingId = trackingId;
        this.payload = sanitizedPayload(payload);
        this.status = status;
        this.errorDetail = sanitizeSensitiveText(errorDetail, payload);
        this.processedAt = Instant.now();
        this.createdAt = Instant.now();
    }

    public NotificationHistory(
            UUID eventId,
            String eventType,
            String trackingId,
            Map<String, Object> payload,
            String status
    ) {
        this(eventId, eventType, trackingId, payload, status, null);
    }

    public UUID getId() { return id; }
    public UUID getEventId() { return eventId; }
    public String getEventType() { return eventType; }
    public String getTrackingId() { return trackingId; }
    public Map<String, Object> getPayload() { return payload; }
    public String getStatus() { return status; }
    public String getErrorDetail() { return errorDetail; }
    public Instant getProcessedAt() { return processedAt; }
    public Instant getCreatedAt() { return createdAt; }

    public void markSuccess() {
        this.payload = sanitizedPayload(payload);
        this.status = "SUCCESS";
        this.errorDetail = null;
        this.processedAt = Instant.now();
    }

    public void markFailure(String detail) {
        this.payload = sanitizedPayload(payload);
        this.status = "FAILED";
        this.errorDetail = detail;
        this.processedAt = Instant.now();
    }

    public static Map<String, Object> sanitizedPayload(Map<String, Object> payload) {
        Map<String, Object> safe = new LinkedHashMap<>();
        payload.forEach((key, value) -> {
            if (!isSensitiveKey(key)) {
                safe.put(key, sanitizeValue(value));
            }
        });
        return safe;
    }

    public static String sanitizeSensitiveText(String text, Map<String, Object> payload) {
        if (text == null) {
            return null;
        }
        List<String> sensitiveValues = new ArrayList<>();
        collectSensitiveValues(payload, sensitiveValues);
        sensitiveValues.removeIf(String::isEmpty);
        sensitiveValues.sort((left, right) -> Integer.compare(right.length(), left.length()));
        String sanitized = text;
        for (String value : sensitiveValues) {
            sanitized = sanitized.replace(value, "[REDACTED]");
        }
        return BEARER_TOKEN.matcher(LABELED_CREDENTIAL.matcher(sanitized)
                .replaceAll("$1$2[REDACTED]"))
                .replaceAll("[REDACTED]");
    }

    private static Object sanitizeValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> safe = new LinkedHashMap<>();
            map.forEach((key, nestedValue) -> {
                String stringKey = String.valueOf(key);
                if (!isSensitiveKey(stringKey)) {
                    safe.put(stringKey, sanitizeValue(nestedValue));
                }
            });
            return safe;
        }
        if (value instanceof List<?> list) {
            return list.stream().map(NotificationHistory::sanitizeValue).toList();
        }
        return value;
    }

    private static boolean isSensitiveKey(String key) {
        String normalized = key.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
        return normalized.contains("token")
                || normalized.contains("password")
                || normalized.contains("secret")
                || normalized.contains("credential")
                || normalized.contains("authorization")
                || normalized.contains("apikey")
                || normalized.contains("privatekey");
    }

    private static void collectSensitiveValues(Object value, List<String> values) {
        if (value instanceof Map<?, ?> map) {
            map.forEach((key, nestedValue) -> {
                if (isSensitiveKey(String.valueOf(key))) {
                    collectStrings(nestedValue, values);
                } else {
                    collectSensitiveValues(nestedValue, values);
                }
            });
        } else if (value instanceof List<?> list) {
            list.forEach(item -> collectSensitiveValues(item, values));
        }
    }

    private static void collectStrings(Object value, List<String> values) {
        if (value instanceof String string) {
            values.add(string);
        } else if (value instanceof Map<?, ?> map) {
            map.values().forEach(item -> collectStrings(item, values));
        } else if (value instanceof List<?> list) {
            list.forEach(item -> collectStrings(item, values));
        }
    }
}
