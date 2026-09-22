package cl.cloudcoffee.notification_service.notifications;

import cl.cloudcoffee.notification_service.history.NotificationHistory;
import cl.cloudcoffee.notification_service.history.NotificationHistoryRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/notifications")
public class NotificationController {

    private final NotificationHistoryRepository repository;

    public NotificationController(NotificationHistoryRepository repository) {
        this.repository = repository;
    }

    @GetMapping
    public Page<NotificationHistory> findAll(
            @PageableDefault(size = 20)
            Pageable pageable
    ) {
        return repository.findAllByOrderByProcessedAtDesc(pageable);
    }
}
