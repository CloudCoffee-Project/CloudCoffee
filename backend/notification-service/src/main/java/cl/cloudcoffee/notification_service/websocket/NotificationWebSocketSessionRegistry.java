package cl.cloudcoffee.notification_service.websocket;

import java.io.IOException;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;

@Component
public class NotificationWebSocketSessionRegistry {

    private static final Logger LOGGER =
            LoggerFactory.getLogger(NotificationWebSocketSessionRegistry.class);

    private final ThreadPoolTaskScheduler scheduler;
    private final ConcurrentHashMap<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, ScheduledFuture<?>> expiryTasks = new ConcurrentHashMap<>();

    public NotificationWebSocketSessionRegistry(ThreadPoolTaskScheduler notificationWebSocketTaskScheduler) {
        this.scheduler = notificationWebSocketTaskScheduler;
    }

    public void register(WebSocketSession session) {
        sessions.put(session.getId(), session);
    }

    public void unregister(String sessionId) {
        sessions.remove(sessionId);
        ScheduledFuture<?> task = expiryTasks.remove(sessionId);
        if (task != null) {
            task.cancel(false);
        }
    }

    public void closeWhenExpired(String sessionId, Instant expiresAt) {
        ScheduledFuture<?> task = scheduler.schedule(
                () -> closeExpiredSession(sessionId),
                expiresAt);
        if (task == null) {
            closeExpiredSession(sessionId);
            return;
        }
        ScheduledFuture<?> previous = expiryTasks.put(sessionId, task);
        if (previous != null) {
            previous.cancel(false);
        }
    }

    public void closeExpiredSession(String sessionId) {
        expiryTasks.remove(sessionId);
        WebSocketSession session = sessions.remove(sessionId);
        if (session == null || !session.isOpen()) {
            return;
        }
        try {
            session.close(new CloseStatus(CloseStatus.POLICY_VIOLATION.getCode(), "JWT expirado"));
        } catch (IOException exception) {
            LOGGER.warn("No se pudo cerrar la sesión WebSocket expirada {}", sessionId, exception);
        }
    }
}
