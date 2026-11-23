package cl.cloudcoffee.notification_service.push;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "app.fcm.enabled", havingValue = "true")
public class NotificationPushWorker {

    private final NotificationPushService pushService;

    public NotificationPushWorker(NotificationPushService pushService) {
        this.pushService = pushService;
    }

    @Scheduled(fixedDelayString = "${app.fcm.dispatch-ms:5000}")
    public void dispatch() {
        pushService.processPending();
    }
}
