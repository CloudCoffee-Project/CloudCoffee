package cl.cloudcoffee.notification_service.devices;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface DeviceTokenRepository extends JpaRepository<DeviceToken, UUID> {

    Optional<DeviceToken> findByTokenHash(String tokenHash);

    List<DeviceToken> findAllByUserIdAndTokenType(UUID userId, DeviceTokenType tokenType);

    long deleteByTokenHashAndUserIdAndPlatform(String tokenHash, UUID userId, DevicePlatform platform);
}
