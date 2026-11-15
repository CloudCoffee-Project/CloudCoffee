package cl.cloudcoffee.notification_service.websocket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import cl.cloudcoffee.notification_service.history.NotificationHistory;
import cl.cloudcoffee.notification_service.history.NotificationHistoryRepository;
import cl.cloudcoffee.notification_service.messaging.CloudCoffeeEvent;
import cl.cloudcoffee.notification_service.messaging.NotificationEventConsumer;
import cl.cloudcoffee.notification_service.websocket.NotificationWebSocketReconciler.ReconciliationOutcome;
import cl.cloudcoffee.notification_service.websocket.NotificationWebSocketReconciler.Resolution;
import cl.cloudcoffee.notification_service.websocket.NotificationWebSocketReconciler.ResourceSnapshot;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import com.nimbusds.jose.JWSAlgorithm;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(properties = {
        "spring.rabbitmq.listener.simple.auto-startup=false",
        "management.health.rabbit.enabled=false",
        "management.health.mail.enabled=false",
        "management.tracing.enabled=false"
})
class NotificationWebSocketReconciliationTests extends JwtTestSupport {

    private static final UUID CLIENT_ID = UUID.randomUUID();
    private static final UUID PURCHASE_ID = UUID.randomUUID();
    private static final UUID ORDER_ID = UUID.randomUUID();
    private static final UUID CAFETERIA_ID = UUID.randomUUID();

    private static final AtomicReference<String> HTTP_ORDER_STATE = new AtomicReference<>("pendiente_pago");
    private static final AtomicInteger HTTP_ORDER_VERSION = new AtomicInteger(1);
    private static final AtomicInteger HTTP_QUERY_COUNT = new AtomicInteger(0);
    private static final HttpServer ORDER_HTTP_SERVER = startOrderHttpServer();

    @Autowired
    private NotificationEventConsumer eventConsumer;

    @Autowired
    private NotificationHistoryRepository historyRepository;

    @Autowired
    private NotificationWebSocketAuthorizationInterceptor authorizationInterceptor;

    @Autowired
    private NotificationWebSocketReconciler reconciler;

    @Autowired
    private JsonMapper jsonMapper;

    @MockitoSpyBean
    private SimpMessagingTemplate messagingTemplate;

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("JWT_PUBLIC_KEY_LOCATION", () -> JwtTestSupport.PUBLIC_KEY_LOCATION);
    }

    @BeforeEach
    void resetState() {
        HTTP_ORDER_STATE.set("pendiente_pago");
        HTTP_ORDER_VERSION.set(1);
        HTTP_QUERY_COUNT.set(0);
        clearInvocations(messagingTemplate);
    }

    @AfterAll
    static void stopServer() {
        ORDER_HTTP_SERVER.stop(0);
    }

    @Test
    void reconciliaPorHttpEventosPerdidosTrasReconexionWebSocket() {
        UUID localOrderId = UUID.randomUUID();
        String destination = "/topic/orden/" + localOrderId + "/estado";

        // 1. Evento inicial (v1) consumido; el cliente se conecta y se suscribe.
        CloudCoffeeEvent createdEvent = orderStateEvent(
                UUID.randomUUID(), "trace-ws-v1", localOrderId, null, "pendiente_pago", 1);
        eventConsumer.consume(createdEvent);

        Message<?> firstSession = stompConnect("session-1", CLIENT_ID, "CLIENTE");
        stompSubscribe(firstSession, destination);

        ReconciliationOutcome initialOutcome = reconciler.onEvent(
                localOrderId, createdEvent, () -> fetchOrderSnapshotViaHttp(localOrderId));
        assertThat(initialOutcome.resolution()).isEqualTo(Resolution.APPLIED_EVENT);
        assertThat(initialOutcome.snapshot().version()).isEqualTo(1L);
        assertThat(initialOutcome.snapshot().status()).isEqualTo("pendiente_pago");
        assertThat(initialOutcome.snapshot().lastTraceId()).isEqualTo("trace-ws-v1");

        // 2. El cliente pierde la conexión WebSocket (DISCONNECT).
        stompDisconnect(firstSession);

        // 3. Mientras está desconectado, ocurren dos eventos en el backend (v2: pagado, v3: listo_para_retiro).
        CloudCoffeeEvent paidEvent = orderStateEvent(
                UUID.randomUUID(), "trace-ws-v2", localOrderId, "pendiente_pago", "pagado", 2);
        CloudCoffeeEvent readyEvent = orderStateEvent(
                UUID.randomUUID(), "trace-ws-v3", localOrderId, "pagado", "listo_para_retiro", 3);
        eventConsumer.consume(paidEvent);
        eventConsumer.consume(readyEvent);
        HTTP_ORDER_STATE.set("listo_para_retiro");
        HTTP_ORDER_VERSION.set(3);

        // 4. El cliente reconecta (nueva sesión STOMP), vuelve a suscribirse primero y consulta HTTP.
        Message<?> reconnectedSession = stompConnect("session-2", CLIENT_ID, "CLIENTE");
        stompSubscribe(reconnectedSession, destination);

        ReconciliationOutcome reconciled = reconciler.reconcileOnReconnect(
                localOrderId, () -> fetchOrderSnapshotViaHttp(localOrderId));

        assertThat(reconciled.resolution()).isEqualTo(Resolution.RECONCILED_VIA_HTTP);
        assertThat(reconciled.snapshot().status()).isEqualTo("listo_para_retiro");
        assertThat(reconciled.snapshot().version()).isEqualTo(3L);
        assertThat(HTTP_QUERY_COUNT.get()).isEqualTo(1);

        // 5. Si llega un evento atrasado/anterior (v2) después de reconciliar, se ignora sin retroceder estado.
        ReconciliationOutcome staleOutcome = reconciler.onEvent(
                localOrderId, paidEvent, () -> fetchOrderSnapshotViaHttp(localOrderId));
        assertThat(staleOutcome.resolution()).isEqualTo(Resolution.IGNORED_STALE);
        assertThat(staleOutcome.snapshot().status()).isEqualTo("listo_para_retiro");
        assertThat(staleOutcome.snapshot().version()).isEqualTo(3L);
    }

    @Test
    void eventoDuplicadoConTraceIdNoRepitePublicacionWebSocketNiAlteraEstadoReconciliado() {
        UUID localOrderId = UUID.randomUUID();
        UUID duplicateEventId = UUID.randomUUID();
        String traceId = "trace-duplicado-" + UUID.randomUUID();

        CloudCoffeeEvent event = orderStateEvent(
                duplicateEventId, traceId, localOrderId, "pagado", "listo_para_retiro", 1);

        // Primera entrega y reentrega duplicada en el consumidor RabbitMQ con el mismo eventId y traceId.
        eventConsumer.consume(event);
        eventConsumer.consume(event);

        verify(messagingTemplate, times(1))
                .convertAndSend(eq("/topic/orden/" + localOrderId + "/estado"), eq(event));
        verify(messagingTemplate, times(1))
                .convertAndSend(eq("/topic/cafeteria/" + CAFETERIA_ID + "/ordenes"), eq(event));

        NotificationHistory recorded = historyRepository.findByEventId(duplicateEventId).orElseThrow();
        assertThat(recorded.getStatus()).isEqualTo("SUCCESS");
        assertThat(recorded.getTrackingId()).isEqualTo(traceId);

        // En el reconciliador, el segundo envío con el mismo eventId y traceId se descarta como duplicado.
        ReconciliationOutcome first = reconciler.onEvent(
                localOrderId, event, () -> fetchOrderSnapshotViaHttp(localOrderId));
        ReconciliationOutcome duplicate = reconciler.onEvent(
                localOrderId, event, () -> fetchOrderSnapshotViaHttp(localOrderId));

        assertThat(first.resolution()).isEqualTo(Resolution.APPLIED_EVENT);
        assertThat(first.snapshot().lastTraceId()).isEqualTo(traceId);
        assertThat(duplicate.resolution()).isEqualTo(Resolution.IGNORED_DUPLICATE);
        assertThat(duplicate.snapshot().version()).isEqualTo(1L);
        assertThat(duplicate.snapshot().lastTraceId()).isEqualTo(traceId);
        assertThat(HTTP_QUERY_COUNT.get()).isZero();
    }

    @Test
    void saltoDeVersionDisparaConsultaHttpYAplicaEventoDeEntregaEnMismaVersion() {
        UUID localOrderId = UUID.randomUUID();

        CloudCoffeeEvent v1 = orderStateEvent(
                UUID.randomUUID(), "trace-jump-v1", localOrderId, null, "pendiente_pago", 1);
        reconciler.onEvent(localOrderId, v1, () -> fetchOrderSnapshotViaHttp(localOrderId));

        // Se pierde v2 y llega directamente v3 (entregado) -> debe reconciliar por HTTP.
        HTTP_ORDER_STATE.set("entregado");
        HTTP_ORDER_VERSION.set(3);
        CloudCoffeeEvent v3 = orderStateEvent(
                UUID.randomUUID(), "trace-jump-v3", localOrderId, "listo_para_retiro", "entregado", 3);

        ReconciliationOutcome jumpOutcome = reconciler.onEvent(
                localOrderId, v3, () -> fetchOrderSnapshotViaHttp(localOrderId));

        assertThat(jumpOutcome.resolution()).isEqualTo(Resolution.RECONCILED_VIA_HTTP);
        assertThat(jumpOutcome.snapshot().status()).isEqualTo("entregado");
        assertThat(jumpOutcome.snapshot().version()).isEqualTo(3L);
        assertThat(jumpOutcome.snapshot().lastTraceId()).isEqualTo("trace-jump-v3");
        assertThat(HTTP_QUERY_COUNT.get()).isEqualTo(1);

        // order.orden.entregada.v1 comparte versión 3 con el cambio a entregado pero tiene distinto eventId.
        CloudCoffeeEvent deliveredEvent = new CloudCoffeeEvent(
                UUID.randomUUID(),
                Instant.now(),
                "trace-jump-v3",
                "order.orden.entregada.v1",
                Map.of(
                        "compraId", PURCHASE_ID.toString(),
                        "ordenId", localOrderId.toString(),
                        "clienteId", CLIENT_ID.toString(),
                        "cafeteriaId", CAFETERIA_ID.toString(),
                        "entregadoAt", Instant.now().toString(),
                        "version", 3
                )
        );

        ReconciliationOutcome deliveredOutcome = reconciler.onEvent(
                localOrderId, deliveredEvent, () -> fetchOrderSnapshotViaHttp(localOrderId));

        assertThat(deliveredOutcome.resolution()).isEqualTo(Resolution.APPLIED_EVENT);
        assertThat(deliveredOutcome.snapshot().version()).isEqualTo(3L);
        assertThat(deliveredOutcome.snapshot().lastEventType()).isEqualTo("order.orden.entregada.v1");
    }

    private CloudCoffeeEvent orderStateEvent(
            UUID eventId,
            String traceId,
            UUID orderId,
            String previousState,
            String state,
            int version
    ) {
        Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("compraId", PURCHASE_ID.toString());
        payload.put("ordenId", orderId.toString());
        payload.put("clienteId", CLIENT_ID.toString());
        payload.put("cafeteriaId", CAFETERIA_ID.toString());
        payload.put("estadoAnterior", previousState);
        payload.put("estado", state);
        payload.put("version", version);
        return new CloudCoffeeEvent(
                eventId,
                Instant.now(),
                traceId,
                "order.orden.estado-cambiado.v1",
                payload
        );
    }

    private ResourceSnapshot fetchOrderSnapshotViaHttp(UUID orderId) {
        try (HttpClient client = HttpClient.newHttpClient()) {
            URI uri = URI.create("http://127.0.0.1:" + ORDER_HTTP_SERVER.getAddress().getPort()
                    + "/orders/" + orderId);
            HttpResponse<String> response = client.send(
                    HttpRequest.newBuilder(uri).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            assertThat(response.statusCode()).isEqualTo(200);
            JsonNode json = jsonMapper.readTree(response.body());
            return new ResourceSnapshot(
                    UUID.fromString(json.path("ordenId").asString()),
                    json.path("estado").asString(),
                    json.path("version").asLong(),
                    null,
                    null,
                    null
            );
        } catch (Exception exception) {
            throw new IllegalStateException("Fallo en consulta HTTP de reconciliación", exception);
        }
    }

    private Message<?> stompConnect(String sessionId, UUID userId, String role) {
        String jwt = JwtTestSupport.sign(
                JwtTestSupport.claims().subject(userId.toString()).claim("role", role).build(),
                JwtTestSupport.KEYS,
                JWSAlgorithm.RS256);
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.CONNECT);
        accessor.setSessionId(sessionId);
        accessor.addNativeHeader("Authorization", "Bearer " + jwt);
        accessor.setLeaveMutable(true);
        Message<byte[]> message = MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
        return authorizationInterceptor.preSend(message, null);
    }

    private void stompSubscribe(Message<?> connectedMessage, String destination) {
        StompHeaderAccessor connected = StompHeaderAccessor.wrap(connectedMessage);
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.SUBSCRIBE);
        accessor.setSessionId(connected.getSessionId());
        accessor.setUser(connected.getUser());
        accessor.setDestination(destination);
        accessor.setLeaveMutable(true);
        authorizationInterceptor.preSend(
                MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders()), null);
    }

    private void stompDisconnect(Message<?> connectedMessage) {
        StompHeaderAccessor connected = StompHeaderAccessor.wrap(connectedMessage);
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.DISCONNECT);
        accessor.setSessionId(connected.getSessionId());
        accessor.setUser(connected.getUser());
        accessor.setLeaveMutable(true);
        authorizationInterceptor.preSend(
                MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders()), null);
    }

    private static HttpServer startOrderHttpServer() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/orders/", exchange -> {
                try (exchange) {
                    HTTP_QUERY_COUNT.incrementAndGet();
                    String path = exchange.getRequestURI().getPath();
                    String orderId = path.substring(path.lastIndexOf('/') + 1);
                    String body = """
                            {"ordenId":"%s","compraId":"%s","estado":"%s","version":%d}
                            """.formatted(orderId, PURCHASE_ID, HTTP_ORDER_STATE.get(), HTTP_ORDER_VERSION.get());
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
                    exchange.getResponseHeaders().set("Cache-Control", "no-store");
                    exchange.sendResponseHeaders(200, bytes.length);
                    exchange.getResponseBody().write(bytes);
                }
            });
            server.start();
            return server;
        } catch (IOException exception) {
            throw new IllegalStateException("No se pudo iniciar el servidor HTTP de órdenes de prueba", exception);
        }
    }
}