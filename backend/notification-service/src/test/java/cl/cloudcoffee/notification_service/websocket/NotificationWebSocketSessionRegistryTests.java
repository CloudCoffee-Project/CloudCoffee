package cl.cloudcoffee.notification_service.websocket;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;

class NotificationWebSocketSessionRegistryTests {

    @Test
    void cierraLaSesionAlVencerElJwt() throws Exception {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.initialize();
        try {
            NotificationWebSocketSessionRegistry registry =
                    new NotificationWebSocketSessionRegistry(scheduler);
            WebSocketSession session = mock(WebSocketSession.class);
            when(session.getId()).thenReturn("session-expiring");
            when(session.isOpen()).thenReturn(true);
            registry.register(session);

            registry.closeWhenExpired("session-expiring", Instant.now().plusMillis(100));

            verify(session, timeout(2000)).close(any(CloseStatus.class));
        } finally {
            scheduler.shutdown();
        }
    }
}
