package cl.cloudcoffee.api_gateway;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicInteger;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "CORS_ALLOWED_ORIGINS=https://app.example.com", "server.ssl.enabled=false",
        "cloudcoffee.rate-limit.login.capacity=2", "cloudcoffee.rate-limit.login.refill-period=PT1H",
        "cloudcoffee.rate-limit.password-recovery.capacity=3",
        "cloudcoffee.rate-limit.password-recovery.refill-period=PT1H",
        "cloudcoffee.rate-limit.verification-resend.capacity=4",
        "cloudcoffee.rate-limit.verification-resend.refill-period=PT1H"})
@AutoConfigureMockMvc
class GatewayRateLimitTests extends cl.cloudcoffee.security.testing.JwtTestSupport {

    private static final BlockingQueue<String> RECEIVED = new LinkedBlockingQueue<>();
    private static final AtomicInteger CLIENTS = new AtomicInteger();
    private static final HttpServer BACKEND = startBackend();

    @DynamicPropertySource
    static void backendUrl(DynamicPropertyRegistry registry) {
        registry.add("AUTH_SERVICE_URL", () -> "http://127.0.0.1:" + BACKEND.getAddress().getPort());
    }

    @Autowired
    MockMvc mvc;

    @LocalServerPort
    int gatewayPort;

    private String address;

    @BeforeEach
    void newClient() {
        address = "192.0.2." + CLIENTS.incrementAndGet();
        RECEIVED.clear();
    }

    @AfterAll
    static void stopBackend() {
        BACKEND.stop(0);
    }

    @ParameterizedTest
    @CsvSource({"login, 2, 401", "password/recovery, 3, 202", "verificacion/reenviar, 4, 202"})
    void eachEndpointHonorsItsConfiguredLimitAndStopsForwarding(String endpoint, int capacity, int status)
            throws Exception {
        String path = "/v1/auth/" + endpoint;
        for (int i = 0; i < capacity; i++) {
            mvc.perform(post(path).with(client()).contentType(MediaType.APPLICATION_JSON).content("{}"))
                    .andExpect(status().is(status));
        }
        for (int i = 0; i < 2; i++) {
            mvc.perform(post(path).with(client()).content("{}")
                            .header(HttpHeaders.ORIGIN, "https://app.example.com"))
                    .andExpect(status().isTooManyRequests())
                    .andExpect(header().string(HttpHeaders.RETRY_AFTER, org.hamcrest.Matchers.matchesPattern("[1-9][0-9]*")))
                    .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "https://app.example.com"))
                    .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                    .andExpect(jsonPath("$.type").value("about:blank"))
                    .andExpect(jsonPath("$.status").value(429))
                    .andExpect(jsonPath("$.title").isNotEmpty())
                    .andExpect(jsonPath("$.detail").isNotEmpty())
                    .andExpect(jsonPath("$.timestamp").isString())
                    .andExpect(jsonPath("$.instance").value(path));
        }
        assertThat(RECEIVED).hasSize(capacity).allMatch(pathReceived -> pathReceived.equals("POST /auth/" + endpoint));
    }

    @Test
    void clientsAndEndpointsHaveIndependentQuotas() throws Exception {
        exhaustLogin();
        mvc.perform(post("/v1/auth/login").with(client())).andExpect(status().isTooManyRequests());
        mvc.perform(post("/v1/auth/login").with(request -> {
            request.setRemoteAddr("198.51.100.1");
            return request;
        })).andExpect(status().isUnauthorized());
        mvc.perform(post("/v1/auth/password/recovery").with(client())).andExpect(status().isAccepted());
        mvc.perform(post("/v1/auth/verificacion/reenviar").with(client())).andExpect(status().isAccepted());
        assertThat(RECEIVED).hasSize(5);
    }

    @Test
    void forwardingHeadersCannotResetTheClientsQuota() throws Exception {
        exhaustLogin();
        mvc.perform(post("/v1/auth/login").with(client())
                        .header("X-Forwarded-For", "203.0.113.50")
                        .header("Forwarded", "for=203.0.113.51"))
                .andExpect(status().isTooManyRequests());
        assertThat(RECEIVED).hasSize(2);
    }

    @Test
    void otherEndpointsAndMethodsAreUnaffectedAfterExhaustingLogin() throws Exception {
        exhaustLogin();
        RECEIVED.clear();
        for (String endpoint : new String[] {"register", "refresh", "verificacion", "password/reset"}) {
            for (int i = 0; i < 5; i++) {
                mvc.perform(post("/v1/auth/" + endpoint).with(client()))
                        .andExpect(status().isAccepted())
                        .andExpect(header().doesNotExist(HttpHeaders.RETRY_AFTER));
            }
        }
        for (String path : new String[] {"/v1/auth/login", "/v1/auth/login/extra", "/v1/auth/users/me"}) {
            mvc.perform(request(HttpMethod.GET, path).with(client()).with(user("cliente")))
                    .andExpect(status().isAccepted());
        }
        mvc.perform(post("/v1/auth/login/extra").with(client()).with(user("cliente")))
                .andExpect(status().isAccepted());
        mvc.perform(get("/v1/auth/users/me").with(client())).andExpect(status().isUnauthorized());
        assertThat(RECEIVED).hasSize(24);
    }

    @Test
    void preflightDoesNotConsumeQuotaOrReachAuth() throws Exception {
        for (int i = 0; i < 5; i++) {
            mvc.perform(options("/v1/auth/login").with(client())
                            .header(HttpHeaders.ORIGIN, "https://app.example.com")
                            .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST"))
                    .andExpect(status().isOk());
        }
        assertThat(RECEIVED).isEmpty();
        exhaustLogin();
        assertThat(RECEIVED).hasSize(2);
    }

    @Test
    void invalidBearerAttemptsStillConsumeQuota() throws Exception {
        for (int i = 0; i < 2; i++) {
            mvc.perform(post("/v1/auth/login").with(client()).header(HttpHeaders.AUTHORIZATION, "Bearer invalid"))
                    .andExpect(status().isUnauthorized());
        }
        mvc.perform(post("/v1/auth/login").with(client())).andExpect(status().isTooManyRequests());
        assertThat(RECEIVED).isEmpty();
    }

    @Test
    void realHttpRequestsConsumeExactlyOneTokenAndReceive429() throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            HttpRequest request = HttpRequest.newBuilder(
                    URI.create("http://localhost:" + gatewayPort + "/v1/auth/login"))
                    .POST(HttpRequest.BodyPublishers.ofString("{}")).build();
            for (int i = 0; i < 2; i++) {
                assertThat(client.send(request, HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(401);
            }
            HttpResponse<String> rejected = client.send(request, HttpResponse.BodyHandlers.ofString());
            assertThat(rejected.statusCode()).isEqualTo(429);
            assertThat(rejected.headers().firstValue(HttpHeaders.RETRY_AFTER)).isPresent();
            assertThat(rejected.body()).contains("\"status\":429");
        }
        assertThat(RECEIVED).hasSize(2);
    }

    private void exhaustLogin() throws Exception {
        for (int i = 0; i < 2; i++) {
            mvc.perform(post("/v1/auth/login").with(client())).andExpect(status().isUnauthorized());
        }
    }

    private RequestPostProcessor client() {
        return request -> {
            request.setRemoteAddr(address);
            return request;
        };
    }

    private static HttpServer startBackend() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", exchange -> {
                try (exchange) {
                    exchange.getRequestBody().readAllBytes();
                    RECEIVED.add(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath());
                    byte[] body = "{}".getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().set(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE);
                    int status = exchange.getRequestMethod().equals("POST")
                            && exchange.getRequestURI().getPath().equals("/auth/login") ? 401 : 202;
                    exchange.sendResponseHeaders(status, body.length);
                    exchange.getResponseBody().write(body);
                }
            });
            server.start();
            return server;
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
    }
}
