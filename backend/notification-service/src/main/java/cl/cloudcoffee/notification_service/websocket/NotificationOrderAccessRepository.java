package cl.cloudcoffee.notification_service.websocket;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface NotificationOrderAccessRepository extends JpaRepository<NotificationOrderAccess, UUID> {
}
