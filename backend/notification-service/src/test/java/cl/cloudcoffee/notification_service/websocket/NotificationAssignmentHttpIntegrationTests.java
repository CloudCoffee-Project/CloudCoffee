package cl.cloudcoffee.notification_service.websocket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import com.nimbusds.jose.JWSAlgorithm;
import com.sun.net.httpserver.HttpServer;
import cl.cloudcoffee.security.InternalServiceAuthenticationFilter;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** Uses the production Spring wiring, STOMP interceptor and HTTP assignment verifier. */
@SpringBootTest(properties = {
        "spring.rabbitmq.listener.simple.auto-startup=false",
        "management.health.rabbit.enabled=false",
        "management.health.mail.enabled=false",
        "management.tracing.enabled=false"
})
@DirtiesContext
class NotificationAssignmentHttpIntegrationTests {

    private static final String TOKEN = "notification-test-internal-" + UUID.randomUUID();
    private static final UUID USER = UUID.randomUUID();
    private static final UUID CAFETERIA = UUID.randomUUID();
    private static final AtomicReference<UUID> ASSIGNMENT = new AtomicReference<>(CAFETERIA);
    private static final AtomicReference<String> RECEIVED_TOKEN = new AtomicReference<>();
    private static final AtomicInteger RESPONSE_STATUS = new AtomicInteger(200);
    private static final AtomicInteger REQUESTS = new AtomicInteger();
    private static final HttpServer AUTH = startAuth();

    @Autowired
    private NotificationWebSocketAuthorizationInterceptor interceptor;

    @DynamicPropertySource
    static void deploymentProperties(DynamicPropertyRegistry registry) {
        registry.add("JWT_PUBLIC_KEY_LOCATION", () -> JwtTestSupport.PUBLIC_KEY_LOCATION);
        registry.add("INTERNAL_SERVICE_TOKEN", () -> TOKEN);
        registry.add("AUTH_SERVICE_URL", () -> "http://127.0.0.1:" + AUTH.getAddress().getPort());
    }

    @BeforeEach
    void resetAssignment() {
        ASSIGNMENT.set(CAFETERIA);
        RESPONSE_STATUS.set(200);
        REQUESTS.set(0);
        RECEIVED_TOKEN.set(null);
    }

    @AfterAll
    static void stopAuth() {
        AUTH.stop(0);
    }

    @ParameterizedTest
    @ValueSource(strings = {"ordenes", "stock"})
    void cashierCanSubscribeOnlyToTheAssignedCafeteria(String topic) {
        Message<?> connection = connect();
        subscribe(connection, CAFETERIA, topic);
        assertThat(RECEIVED_TOKEN.get()).isEqualTo(TOKEN);
        assertThatThrownBy(() -> subscribe(connection, UUID.randomUUID(), topic))
                .isInstanceOf(AccessDeniedException.class);
        assertThat(REQUESTS.get()).isEqualTo(2);
    }

    @Test
    void changingAssignmentInvalidatesTheNextSubscriptionEvenWithTheSameJwt() {
        Message<?> connection = connect();
        subscribe(connection, CAFETERIA, "ordenes");
        UUID next = UUID.randomUUID();
        ASSIGNMENT.set(next);
        assertThatThrownBy(() -> subscribe(connection, CAFETERIA, "ordenes"))
                .isInstanceOf(AccessDeniedException.class);
        subscribe(connection, next, "ordenes");
        assertThat(REQUESTS.get()).isEqualTo(3);
    }

    @ParameterizedTest
    @ValueSource(ints = {401, 404, 503})
    void unverifiableAssignmentNeverGrantsAccess(int status) {
        RESPONSE_STATUS.set(status);
        assertThatThrownBy(() -> subscribe(connect(), CAFETERIA, "ordenes"))
                .isInstanceOf(AccessDeniedException.class);
        assertThat(REQUESTS.get()).isEqualTo(1);
    }

    private Message<?> connect() {
        String jwt = JwtTestSupport.sign(JwtTestSupport.claims().subject(USER.toString())
                .claim("role", "CAJERO").claim("cafeteriaId", CAFETERIA.toString()).build(),
                JwtTestSupport.KEYS, JWSAlgorithm.RS256);
        var accessor = StompHeaderAccessor.create(StompCommand.CONNECT);
        accessor.setSessionId("assignment-test-" + UUID.randomUUID());
        accessor.addNativeHeader("Authorization", "Bearer " + jwt);
        accessor.setLeaveMutable(true);
        var message = MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
        return interceptor.preSend(message, null);
    }

    private void subscribe(Message<?> connection, UUID cafeteria, String topic) {
        var connected = StompHeaderAccessor.wrap(connection);
        var accessor = StompHeaderAccessor.create(StompCommand.SUBSCRIBE);
        accessor.setSessionId(connected.getSessionId());
        accessor.setUser(connected.getUser());
        accessor.setDestination("/topic/cafeteria/" + cafeteria + "/" + topic);
        accessor.setLeaveMutable(true);
        interceptor.preSend(MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders()), null);
    }

    private static HttpServer startAuth() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", exchange -> {
                try (exchange) {
                    REQUESTS.incrementAndGet();
                    String token = exchange.getRequestHeaders().getFirst(InternalServiceAuthenticationFilter.HEADER);
                    RECEIVED_TOKEN.set(token);
                    int status = TOKEN.equals(token) ? RESPONSE_STATUS.get() : 401;
                    if (!exchange.getRequestURI().getPath().equals("/internal/servicios/asignaciones/" + USER)) {
                        status = 404;
                    }
                    byte[] body = ("{\"cafeteriaId\":\"" + ASSIGNMENT.get() + "\"}")
                            .getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
                    exchange.sendResponseHeaders(status, body.length);
                    exchange.getResponseBody().write(body);
                }
            });
            server.start();
            return server;
        } catch (IOException exception) {
            throw new IllegalStateException("Cannot start test Auth HTTP server", exception);
        }
    }
}
