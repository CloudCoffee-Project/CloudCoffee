package cl.cloudcoffee.api_gateway;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"OPENAPI_ENABLED=true", "CORS_ALLOWED_ORIGINS=", "management.tracing.enabled=false"})
@AutoConfigureMockMvc
class GatewayOpenApiTests extends cl.cloudcoffee.security.testing.JwtTestSupport {
    private static final Backend AUTH = new Backend("Auth");
    private static final Backend CATALOG = new Backend("Catálogo");
    @Autowired MockMvc mvc;

    @DynamicPropertySource
    static void backends(DynamicPropertyRegistry registry) {
        registry.add("AUTH_SERVICE_URL", AUTH::url);
        registry.add("CATALOG_SERVICE_URL", CATALOG::url);
    }

    @BeforeEach
    void clear() {
        AUTH.requests.clear();
        CATALOG.requests.clear();
    }

    @AfterAll
    static void stop() {
        AUTH.server.stop(0);
        CATALOG.server.stop(0);
    }

    @Test
    void swaggerLoadsItsConfigurationAndAssetsWithoutJwt() throws Exception {
        mvc.perform(get("/swagger-ui.html"))
                .andExpect(status().is3xxRedirection()).andExpect(redirectedUrl("/swagger-ui/index.html"));
        mvc.perform(get("/swagger-ui/index.html"))
                .andExpect(status().isOk()).andExpect(content().string(org.hamcrest.Matchers.containsString("Swagger UI")));
        mvc.perform(get("/swagger-ui/swagger-initializer.js"))
                .andExpect(status().isOk()).andExpect(content().string(org.hamcrest.Matchers.containsString("/v3/api-docs/swagger-config")));
        mvc.perform(get("/v3/api-docs/swagger-config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.urls[0].name").value("Auth"))
                .andExpect(jsonPath("$.urls[0].url").value("/openapi/auth"))
                .andExpect(jsonPath("$.urls[1].name").value("Catálogo"))
                .andExpect(jsonPath("$.urls[1].url").value("/openapi/catalog"));
    }

    @Test
    void contractsUseTheCorrectBackendAndPreserveRelativeServers() throws Exception {
        for (String[] contract : new String[][]{{"auth", "Auth"}, {"catalog", "Catálogo"}}) {
            mvc.perform(get("/openapi/" + contract[0]))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.info.title").value(contract[1]))
                    .andExpect(jsonPath("$.servers[0].url").value("/v1"));
        }
        assertThat(AUTH.requests).containsExactly("GET /v3/api-docs");
        assertThat(CATALOG.requests).containsExactly("GET /v3/api-docs");
    }

    @Test
    void onlyGetAndHeadCanReadContractsAndJwtRulesRemainInEffect() throws Exception {
        mvc.perform(head("/openapi/auth")).andExpect(status().isOk()).andExpect(content().string(""));
        mvc.perform(head("/openapi/catalog")).andExpect(status().isOk()).andExpect(content().string(""));
        assertThat(AUTH.requests).containsExactly("HEAD /v3/api-docs");
        assertThat(CATALOG.requests).containsExactly("HEAD /v3/api-docs");
        AUTH.requests.clear();
        CATALOG.requests.clear();
        mvc.perform(post("/openapi/auth")).andExpect(status().is4xxClientError());
        mvc.perform(get("/openapi/auth/extra")).andExpect(status().isNotFound());
        mvc.perform(get("/openapi/auth").header("Authorization", "Bearer malformed"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/v1/catalog/productos")).andExpect(status().isUnauthorized());
        mvc.perform(get("/v1/auth/users/me")).andExpect(status().isUnauthorized());
        assertThat(AUTH.requests).isEmpty();
        assertThat(CATALOG.requests).isEmpty();
    }

    @Test
    void backendFailuresAreVisibleInsteadOfBeingReplacedByAnEmptyContract() throws Exception {
        AUTH.status = 503;
        try {
            mvc.perform(get("/openapi/auth")).andExpect(status().isServiceUnavailable());
        } finally {
            AUTH.status = 200;
        }
    }

    private static final class Backend {
        final HttpServer server;
        final List<String> requests = new CopyOnWriteArrayList<>();
        volatile int status = 200;

        Backend(String title) {
            try {
                server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
                server.createContext("/", exchange -> {
                    requests.add(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath());
                    byte[] json = ("{\"openapi\":\"3.1.0\",\"info\":{\"title\":\"" + title
                            + "\",\"version\":\"v1\"},\"servers\":[{\"url\":\"/v1\"}],\"paths\":{}}")
                            .getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
                    boolean head = exchange.getRequestMethod().equals("HEAD");
                    exchange.sendResponseHeaders(status, head ? -1 : json.length);
                    if (!head) exchange.getResponseBody().write(json);
                    exchange.close();
                });
                server.start();
            } catch (java.io.IOException exception) {
                throw new java.io.UncheckedIOException(exception);
            }
        }

        String url() {
            return "http://127.0.0.1:" + server.getAddress().getPort();
        }
    }
}
