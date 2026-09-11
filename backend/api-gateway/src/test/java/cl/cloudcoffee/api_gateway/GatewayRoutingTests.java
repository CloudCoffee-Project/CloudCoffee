package cl.cloudcoffee.api_gateway;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
class GatewayRoutingTests {

    private static final Map<String, BackendStub> BACKENDS = Map.of(
            "auth", new BackendStub("auth"),
            "catalog", new BackendStub("catalog"),
            "notifications", new BackendStub("notifications"));

    @DynamicPropertySource
    static void backendUrls(DynamicPropertyRegistry registry) {
        registry.add("AUTH_SERVICE_URL", () -> BACKENDS.get("auth").url());
        registry.add("CATALOG_SERVICE_URL", () -> BACKENDS.get("catalog").url());
        registry.add("NOTIFICATION_SERVICE_URL", () -> BACKENDS.get("notifications").url());
    }

    @Autowired
    MockMvc mvc;

    @LocalServerPort
    int gatewayPort;

    @BeforeEach
    void clearRequests() {
        BACKENDS.values().forEach(backend -> backend.requests.clear());
    }

    @AfterAll
    static void stopBackends() {
        BACKENDS.values().forEach(backend -> backend.server.stop(0));
    }

    @ParameterizedTest
    @CsvSource({
            "auth, /v1/auth/users/me, /auth/users/me",
            "catalog, /v1/catalog/productos/42, /catalog/productos/42",
            "notifications, /v1/notifications/42, /notifications/42"
    })
    void routesToTheCorrectBackendAndStripsOnlyTheVersion(String service,
            String externalPath, String internalPath) throws Exception {
        // La identidad se inyecta solo en el test; no hay autenticacion simulada en produccion.
        mvc.perform(get(externalPath).with(user("cliente")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.service").value(service));

        assertThat(BACKENDS.get(service).take().path()).isEqualTo(internalPath);
        assertNoBackendRequests();
    }

    @ParameterizedTest
    @ValueSource(strings = {"register", "login", "refresh", "verificacion",
            "verificacion/reenviar", "password/recovery", "password/reset"})
    void publicAuthPostsDoNotRequireAuthentication(String endpoint) throws Exception {
        mvc.perform(post("/v1/auth/" + endpoint)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist(HttpHeaders.SET_COOKIE));

        RecordedRequest received = BACKENDS.get("auth").take();
        assertThat(received.method()).isEqualTo("POST");
        assertThat(received.path()).isEqualTo("/auth/" + endpoint);
    }

    @ParameterizedTest
    @CsvSource({"GET, campus", "GET, categorias", "HEAD, campus", "HEAD, categorias"})
    void catalogQueriesArePublic(String method, String endpoint) throws Exception {
        mvc.perform(request(HttpMethod.valueOf(method), "/v1/catalog/" + endpoint))
                .andExpect(status().isOk());

        RecordedRequest received = BACKENDS.get("catalog").take();
        assertThat(received.method()).isEqualTo(method);
        assertThat(received.path()).isEqualTo("/catalog/" + endpoint);
    }

    @Test
    void preservesBodyQueryParametersAndAuthorizationHeader() throws Exception {
        String body = "{\"nombre\":\"María\"}";
        mvc.perform(patch(URI.create("/v1/auth/users/me?tag=caf%C3%A9&tag=a%2Bb"))
                        .with(user("cliente"))
                        .header(HttpHeaders.AUTHORIZATION, "Bearer test-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body.getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isOk());

        RecordedRequest received = BACKENDS.get("auth").take();
        assertThat(received.method()).isEqualTo("PATCH");
        assertThat(received.path()).isEqualTo("/auth/users/me");
        assertThat(received.query()).isEqualTo("tag=caf%C3%A9&tag=a%2Bb");
        assertThat(received.body()).isEqualTo(body);
        assertThat(received.authorization()).isEqualTo("Bearer test-token");
        assertThat(received.contentType()).startsWith(MediaType.APPLICATION_JSON_VALUE);
    }

    @Test
    void preservesDownstreamStatusHeadersAndProblemDetails() throws Exception {
        mvc.perform(post("/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reject\":true}"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string(HttpHeaders.WWW_AUTHENTICATE, "Bearer"))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(content().json(BackendStub.PROBLEM));
        assertThat(BACKENDS.get("auth").take().path()).isEqualTo("/auth/login");
    }

    @ParameterizedTest
    @CsvSource({
            "GET, /v1/auth/users/me",
            "PATCH, /v1/auth/users/me/password",
            "POST, /v1/auth/logout",
            "GET, /v1/notifications",
            "POST, /v1/catalog/campus",
            "DELETE, /v1/catalog/categorias",
            "GET, /v1/auth/login",
            "POST, /v1/auth/login/extra",
            "GET, /v1/catalog/campus/extra"
    })
    void protectedPathsAndMethodsRejectAnonymousRequests(String method, String path) throws Exception {
        mvc.perform(request(HttpMethod.valueOf(method), path))
                .andExpect(status().isUnauthorized())
                .andExpect(header().doesNotExist(HttpHeaders.SET_COOKIE));
        assertNoBackendRequests();
    }

    @ParameterizedTest
    @ValueSource(strings = {"Bearer arbitrary-token", "Basic dXNlcjpwYXNzd29yZA=="})
    void unverifiedCredentialsCannotOpenProtectedRoutes(String authorization) throws Exception {
        mvc.perform(get("/v1/notifications")
                        .header(HttpHeaders.AUTHORIZATION, authorization)
                        .header("X-User-Id", "1")
                        .header("X-User-Role", "ADMIN"))
                .andExpect(status().isUnauthorized());
        assertNoBackendRequests();
    }

    @ParameterizedTest
    @ValueSource(strings = {"/auth/login", "/catalog/campus", "/notifications",
            "/internal/test/events", "/v1/internal/test/events", "/v1/unknown",
            "/v2/auth/login", "/v1/authentication/login"})
    void unknownAndUnversionedPathsAreNotForwarded(String path) throws Exception {
        mvc.perform(get(path).with(user("cliente")))
                .andExpect(status().isNotFound());
        assertNoBackendRequests();
    }

    @Test
    void publicRequestWorksThroughTheRealHttpServer() throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            HttpResponse<String> response = client.send(HttpRequest.newBuilder(
                            URI.create("http://localhost:" + gatewayPort + "/v1/catalog/campus"))
                            .GET().build(), HttpResponse.BodyHandlers.ofString());
            assertThat(response.statusCode()).isEqualTo(200);
            assertThat(response.body()).isEqualTo("{\"service\":\"catalog\"}");
        }
        assertThat(BACKENDS.get("catalog").take().path()).isEqualTo("/catalog/campus");
    }

    private void assertNoBackendRequests() {
        BACKENDS.forEach((service, backend) ->
                assertThat(backend.requests).as("Solicitudes pendientes en %s", service).isEmpty());
    }

    private record RecordedRequest(String method, String path, String query,
            String body, String authorization, String contentType) {
    }

    private static final class BackendStub {
        static final String PROBLEM = """
                {"type":"about:blank","title":"Unauthorized","status":401,
                 "detail":"Credenciales incorrectas","instance":"/auth/login",
                 "timestamp":"2026-09-10T12:00:00Z"}
                """;

        final HttpServer server;
        final BlockingQueue<RecordedRequest> requests = new LinkedBlockingQueue<>();

        BackendStub(String name) {
            try {
                server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
                server.createContext("/", exchange -> {
                    try (exchange) {
                        String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                        requests.add(new RecordedRequest(exchange.getRequestMethod(),
                                exchange.getRequestURI().getRawPath(), exchange.getRequestURI().getRawQuery(),
                                body, exchange.getRequestHeaders().getFirst(HttpHeaders.AUTHORIZATION),
                                exchange.getRequestHeaders().getFirst(HttpHeaders.CONTENT_TYPE)));
                        boolean reject = body.equals("{\"reject\":true}");
                        byte[] response = (reject ? PROBLEM : "{\"service\":\"" + name + "\"}")
                                .getBytes(StandardCharsets.UTF_8);
                        exchange.getResponseHeaders().set(HttpHeaders.CONTENT_TYPE,
                                reject ? MediaType.APPLICATION_PROBLEM_JSON_VALUE : MediaType.APPLICATION_JSON_VALUE);
                        if (reject) {
                            exchange.getResponseHeaders().set(HttpHeaders.WWW_AUTHENTICATE, "Bearer");
                        }
                        boolean head = exchange.getRequestMethod().equals("HEAD");
                        exchange.sendResponseHeaders(reject ? 401 : 200, head ? -1 : response.length);
                        if (!head) {
                            exchange.getResponseBody().write(response);
                        }
                    }
                });
                server.start();
            } catch (IOException exception) {
                throw new UncheckedIOException(exception);
            }
        }

        String url() {
            return "http://127.0.0.1:" + server.getAddress().getPort();
        }

        RecordedRequest take() throws InterruptedException {
            RecordedRequest request = requests.poll(5, TimeUnit.SECONDS);
            assertThat(request).as("El backend debio recibir la solicitud").isNotNull();
            return request;
        }
    }
}
