package cl.cloudcoffee.notification_service.push;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.data.domain.Pageable;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface NotificationPushDeliveryRepository
        extends JpaRepository<NotificationPushDelivery, UUID> {

    boolean existsByEventIdAndChannelAndDeviceTokenId(UUID eventId, String channel, UUID deviceTokenId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select delivery from NotificationPushDelivery delivery
            where delivery.status = 'PENDING' and delivery.nextAttemptAt <= :now
            order by delivery.createdAt
            """)
    List<NotificationPushDelivery> lockDueDeliveries(@Param("now") Instant now, Pageable pageable);
}
