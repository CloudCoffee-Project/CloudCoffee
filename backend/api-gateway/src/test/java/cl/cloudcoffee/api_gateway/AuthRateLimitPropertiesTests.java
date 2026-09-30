package cl.cloudcoffee.api_gateway;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

import static org.assertj.core.api.Assertions.assertThat;

class AuthRateLimitPropertiesTests {

    private final ApplicationContextRunner context = new ApplicationContextRunner()
            .withUserConfiguration(PropertiesConfig.class)
            .withPropertyValues(
                    "cloudcoffee.rate-limit.login.capacity=5",
                    "cloudcoffee.rate-limit.login.refill-period=PT1M",
                    "cloudcoffee.rate-limit.password-recovery.capacity=3",
                    "cloudcoffee.rate-limit.password-recovery.refill-period=PT15M",
                    "cloudcoffee.rate-limit.verification-resend.capacity=3",
                    "cloudcoffee.rate-limit.verification-resend.refill-period=PT15M");

    @ParameterizedTest
    @ValueSource(strings = {"login", "password-recovery", "verification-resend"})
    void invalidLimitsPreventStartup(String endpoint) {
        for (String value : new String[] {"capacity=0", "capacity=-1", "refill-period=PT0S",
                "refill-period=-PT1M", "refill-period=invalid"}) {
            context.withPropertyValues("cloudcoffee.rate-limit." + endpoint + "." + value)
                    .run(application -> assertThat(application).hasFailed());
        }
    }

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(AuthRateLimitProperties.class)
    static class PropertiesConfig {
    }
}
