package cl.cloudcoffee.notification_service.websocket;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

@Configuration(proxyBeanMethods = false)
public class NotificationWebSocketSchedulerConfiguration {

    @Bean
    ThreadPoolTaskScheduler notificationWebSocketTaskScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix("notification-ws-expiry-");
        scheduler.setRemoveOnCancelPolicy(true);
        return scheduler;
    }
}
