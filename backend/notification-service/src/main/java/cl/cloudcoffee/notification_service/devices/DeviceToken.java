package cl.cloudcoffee.notification_service.devices;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "notification_device_token")
public class DeviceToken {

    @Id
    private UUID id;

    @Column(name = "token", nullable = false, columnDefinition = "TEXT")
    private String token;

    @Column(name = "token_hash", nullable = false, length = 64, unique = true)
    private String tokenHash;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(name = "platform", nullable = false, length = 10)
    private DevicePlatform platform;

    @Enumerated(EnumType.STRING)
    @Column(name = "token_type", nullable = false, length = 10)
    private DeviceTokenType tokenType;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected DeviceToken() {
    }

    public DeviceToken(String token, String tokenHash, UUID userId,
            DevicePlatform platform, DeviceTokenType tokenType, Instant now) {
        this.id = UUID.randomUUID();
        this.token = token;
        this.tokenHash = tokenHash;
        this.userId = userId;
        this.platform = platform;
        this.tokenType = tokenType;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void updateRegistration(String token, UUID userId, DevicePlatform platform,
            DeviceTokenType tokenType, Instant now) {
        this.token = token;
        this.userId = userId;
        this.platform = platform;
        this.tokenType = tokenType;
        this.updatedAt = now;
    }
}
