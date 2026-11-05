package cl.cloudcoffee.notification_service.websocket;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface NotificationPurchaseAccessRepository extends JpaRepository<NotificationPurchaseAccess, UUID> {
}
