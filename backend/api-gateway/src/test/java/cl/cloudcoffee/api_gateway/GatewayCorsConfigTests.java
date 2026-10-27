package cl.cloudcoffee.api_gateway;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import static org.assertj.core.api.Assertions.assertThat;

class GatewayCorsConfigTests {

    @ParameterizedTest
    @ValueSource(strings = {"*", "https://*.example.com", "http://localhost:3000,*"})
    void wildcardOriginsPreventStartup(String origins) {
        new ApplicationContextRunner().withUserConfiguration(GatewayCorsConfig.class)
                .withPropertyValues("cloudcoffee.cors.allowed-origins=" + origins)
                .run(context -> assertThat(context).hasFailed()
                        .getFailure().hasRootCauseInstanceOf(IllegalArgumentException.class)
                        .hasStackTraceContaining("CORS_ALLOWED_ORIGINS debe contener origenes exactos"));
    }

    @Test
    void registersExactAllowedAndExposedHeadersForIdempotencyAndRetries() {
        new ApplicationContextRunner().withUserConfiguration(GatewayCorsConfig.class)
                .withPropertyValues("cloudcoffee.cors.allowed-origins=http://localhost:3000, https://app.example.com")
                .run(context -> {
                    UrlBasedCorsConfigurationSource source = context.getBean(UrlBasedCorsConfigurationSource.class);
                    CorsConfiguration config = source.getCorsConfiguration(
                            new MockHttpServletRequest("OPTIONS", "/v1/catalog/productos/42/ofertas"));

                    assertThat(config).isNotNull();
                    assertThat(config.getAllowedOrigins())
                            .containsExactly("http://localhost:3000", "https://app.example.com");
                    assertThat(config.getAllowedMethods())
                            .containsExactly("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS");
                    assertThat(config.getAllowedHeaders()).containsExactly(
                            HttpHeaders.AUTHORIZATION,
                            HttpHeaders.CONTENT_TYPE,
                            HttpHeaders.ACCEPT,
                            GatewayCorsConfig.IDEMPOTENCY_KEY);
                    assertThat(config.getExposedHeaders()).containsExactly(
                            HttpHeaders.LOCATION,
                            GatewayCorsConfig.IDEMPOTENCY_REPLAYED,
                            HttpHeaders.RETRY_AFTER);
                    assertThat(config.getAllowCredentials()).isFalse();
                });
    }
}
