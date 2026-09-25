package cl.cloudcoffee.api_gateway;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

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
}
