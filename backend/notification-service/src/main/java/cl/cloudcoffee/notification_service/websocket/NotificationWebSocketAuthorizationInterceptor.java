package cl.cloudcoffee.notification_service.websocket;

import java.time.Instant;
import java.util.List;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessagingException;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;

@Component
public class NotificationWebSocketAuthorizationInterceptor implements ChannelInterceptor {

    private static final String AUTHORIZATION = "Authorization";
    private static final String BEARER_PREFIX = "Bearer ";

    private final JwtDecoder jwtDecoder;
    private final NotificationSubscriptionAuthorizer subscriptionAuthorizer;
    private final NotificationWebSocketSessionRegistry sessionRegistry;

    public NotificationWebSocketAuthorizationInterceptor(
            JwtDecoder jwtDecoder,
            NotificationSubscriptionAuthorizer subscriptionAuthorizer,
            NotificationWebSocketSessionRegistry sessionRegistry
    ) {
        this.jwtDecoder = jwtDecoder;
        this.subscriptionAuthorizer = subscriptionAuthorizer;
        this.sessionRegistry = sessionRegistry;
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor =
                MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null || accessor.getCommand() == null) {
            return message;
        }

        if (StompCommand.CONNECT.equals(accessor.getCommand())) {
            authenticate(accessor);
            return message;
        }
        if (StompCommand.DISCONNECT.equals(accessor.getCommand())) {
            return message;
        }

        if (!(accessor.getUser() instanceof JwtAuthenticationToken authentication)) {
            throw new MessagingException("Se requiere una sesión WebSocket autenticada.");
        }
        Instant expiresAt = authentication.getToken().getExpiresAt();
        if (expiresAt == null || !Instant.now().isBefore(expiresAt)) {
            sessionRegistry.closeExpiredSession(accessor.getSessionId());
            throw new MessagingException("La sesión WebSocket expiró.");
        }
        if (StompCommand.SUBSCRIBE.equals(accessor.getCommand())) {
            subscriptionAuthorizer.authorize(authentication, accessor.getDestination());
        } else if (StompCommand.SEND.equals(accessor.getCommand())) {
            throw new MessagingException("No se permiten envíos de clientes a destinos de negocio.");
        }
        return message;
    }

    private void authenticate(StompHeaderAccessor accessor) {
        List<String> headers = accessor.getNativeHeader(AUTHORIZATION);
        if (headers == null || headers.size() != 1 || !headers.getFirst().startsWith(BEARER_PREFIX)) {
            throw new MessagingException("CONNECT requiere un JWT Bearer en el header Authorization.");
        }

        String rawToken = headers.getFirst().substring(BEARER_PREFIX.length()).trim();
        if (rawToken.isEmpty()) {
            throw new MessagingException("CONNECT requiere un JWT Bearer válido.");
        }
        try {
            Jwt jwt = jwtDecoder.decode(rawToken);
            String role = jwt.getClaimAsString("role");
            if (jwt.getExpiresAt() == null || jwt.getSubject() == null || role == null) {
                throw new MessagingException("El JWT no contiene identidad, rol y expiración.");
            }
            JwtAuthenticationToken authentication = new JwtAuthenticationToken(
                    jwt, List.of(new SimpleGrantedAuthority("ROLE_" + role)), jwt.getSubject());
            accessor.setUser(authentication);
            sessionRegistry.closeWhenExpired(accessor.getSessionId(), jwt.getExpiresAt());
        } catch (JwtException exception) {
            throw new MessagingException("JWT WebSocket inválido o expirado.", exception);
        }
    }
}
