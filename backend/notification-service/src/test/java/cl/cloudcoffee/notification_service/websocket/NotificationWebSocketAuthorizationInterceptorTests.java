package cl.cloudcoffee.notification_service.websocket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessagingException;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;

class NotificationWebSocketAuthorizationInterceptorTests {

    private JwtDecoder jwtDecoder;
    private NotificationSubscriptionAuthorizer subscriptionAuthorizer;
    private NotificationWebSocketSessionRegistry sessionRegistry;
    private NotificationWebSocketAuthorizationInterceptor interceptor;

    @BeforeEach
    void setUp() {
        jwtDecoder = mock(JwtDecoder.class);
        subscriptionAuthorizer = mock(NotificationSubscriptionAuthorizer.class);
        sessionRegistry = mock(NotificationWebSocketSessionRegistry.class);
        interceptor = new NotificationWebSocketAuthorizationInterceptor(
                jwtDecoder, subscriptionAuthorizer, sessionRegistry);
    }

    @Test
    void connectExigeJwtBearerEnHeaderYProgramaCierrePorExpiracion() {
        UUID userId = UUID.randomUUID();
        Instant expiresAt = Instant.now().plusSeconds(120);
        Jwt jwt = Jwt.withTokenValue("signed-token")
                .header("alg", "RS256")
                .subject(userId.toString())
                .claim("role", "CLIENTE")
                .issuedAt(Instant.now())
                .expiresAt(expiresAt)
                .build();
        when(jwtDecoder.decode("signed-token")).thenReturn(jwt);

        Message<?> result = interceptor.preSend(connectMessage("Bearer signed-token"), mock(MessageChannel.class));

        assertThat(StompHeaderAccessor.wrap(result).getUser())
                .isInstanceOf(JwtAuthenticationToken.class);
        verify(sessionRegistry).closeWhenExpired("session-1", expiresAt);
    }

    @Test
    void connectSinBearerEsRechazado() {
        assertThatThrownBy(() -> interceptor.preSend(connectMessage(null), mock(MessageChannel.class)))
                .isInstanceOf(MessagingException.class);
    }

    @Test
    void clienteNoPuedeEnviarMensajesDeNegocio() {
        Message<?> sendMessage = authenticatedMessage(StompCommand.SEND, "/topic/compra/1/estado");

        assertThatThrownBy(() -> interceptor.preSend(sendMessage, mock(MessageChannel.class)))
                .isInstanceOf(MessagingException.class)
                .hasMessageContaining("No se permiten envíos");
    }

    @Test
    void suscripcionPasaPorElAutorizadorDeDestinos() {
        String destination = "/topic/cafeteria/" + UUID.randomUUID() + "/stock";
        Message<?> subscribeMessage = authenticatedMessage(StompCommand.SUBSCRIBE, destination);

        interceptor.preSend(subscribeMessage, mock(MessageChannel.class));

        verify(subscriptionAuthorizer).authorize(
                org.mockito.ArgumentMatchers.any(JwtAuthenticationToken.class),
                org.mockito.ArgumentMatchers.eq(destination));
    }

    private static Message<?> connectMessage(String authorization) {
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.CONNECT);
        accessor.setSessionId("session-1");
        if (authorization != null) {
            accessor.addNativeHeader("Authorization", authorization);
        }
        accessor.setLeaveMutable(true);
        return MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
    }

    private static Message<?> authenticatedMessage(StompCommand command, String destination) {
        UUID userId = UUID.randomUUID();
        Jwt jwt = Jwt.withTokenValue("signed-token")
                .header("alg", "RS256")
                .subject(userId.toString())
                .claim("role", "CLIENTE")
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(120))
                .build();
        StompHeaderAccessor accessor = StompHeaderAccessor.create(command);
        accessor.setSessionId("session-1");
        accessor.setUser(new JwtAuthenticationToken(jwt));
        accessor.setDestination(destination);
        accessor.setLeaveMutable(true);
        return MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
    }
}
