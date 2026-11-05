package cl.cloudcoffee.notification_service.websocket;

import java.util.Arrays;
import java.util.List;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.WebSocketHandlerDecorator;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;

@Configuration
@EnableWebSocketMessageBroker
public class NotificationWebSocketConfiguration implements WebSocketMessageBrokerConfigurer {

    private final ObjectProvider<NotificationWebSocketAuthorizationInterceptor> authorizationInterceptor;
    private final ObjectProvider<NotificationWebSocketSessionRegistry> sessionRegistry;
    private final List<String> allowedOrigins;

    public NotificationWebSocketConfiguration(
            ObjectProvider<NotificationWebSocketAuthorizationInterceptor> authorizationInterceptor,
            ObjectProvider<NotificationWebSocketSessionRegistry> sessionRegistry,
            @org.springframework.beans.factory.annotation.Value(
                    "${app.websocket.allowed-origins:http://localhost:3000,http://127.0.0.1:3000}") String origins
    ) {
        this.authorizationInterceptor = authorizationInterceptor;
        this.sessionRegistry = sessionRegistry;
        this.allowedOrigins = Arrays.stream(origins.split(","))
                .map(String::trim)
                .filter(origin -> !origin.isEmpty())
                .toList();
        if (allowedOrigins.stream().anyMatch(origin -> origin.contains("*"))) {
            throw new IllegalArgumentException("WEBSOCKET_ALLOWED_ORIGINS debe usar origenes exactos");
        }
    }

    @Override
    public void configureMessageBroker(
            org.springframework.messaging.simp.config.MessageBrokerRegistry registry
    ) {
        registry.enableSimpleBroker("/topic");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/notifications/ws")
                .setAllowedOrigins(allowedOrigins.toArray(String[]::new))
                .withSockJS();
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(authorizationInterceptor.getObject());
    }

    @Override
    public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
        NotificationWebSocketSessionRegistry registry = sessionRegistry.getObject();
        registration.addDecoratorFactory(handler -> new SessionTrackingWebSocketHandler(handler, registry));
    }

    private static final class SessionTrackingWebSocketHandler extends WebSocketHandlerDecorator {

        private final NotificationWebSocketSessionRegistry sessionRegistry;

        private SessionTrackingWebSocketHandler(
                WebSocketHandler delegate,
                NotificationWebSocketSessionRegistry sessionRegistry
        ) {
            super(delegate);
            this.sessionRegistry = sessionRegistry;
        }

        @Override
        public void afterConnectionEstablished(WebSocketSession session) throws Exception {
            sessionRegistry.register(session);
            super.afterConnectionEstablished(session);
        }

        @Override
        public void afterConnectionClosed(
                WebSocketSession session,
                org.springframework.web.socket.CloseStatus closeStatus
        ) throws Exception {
            sessionRegistry.unregister(session.getId());
            super.afterConnectionClosed(session, closeStatus);
        }
    }
}
