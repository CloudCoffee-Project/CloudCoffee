package cl.cloudcoffee.notification_service.history;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface NotificationHistoryRepository
        extends JpaRepository<NotificationHistory, UUID> {

    boolean existsByEventId(UUID eventId);

    Page<NotificationHistory> findAllByOrderByProcessedAtDesc(Pageable pageable);
}
