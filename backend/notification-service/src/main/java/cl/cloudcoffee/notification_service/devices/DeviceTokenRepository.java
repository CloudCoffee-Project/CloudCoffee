package cl.cloudcoffee.notification_service.devices;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface DeviceTokenRepository extends JpaRepository<DeviceToken, UUID> {

    Optional<DeviceToken> findByTokenHash(String tokenHash);

    long deleteByTokenHashAndUserIdAndPlatform(String tokenHash, UUID userId, DevicePlatform platform);
}
