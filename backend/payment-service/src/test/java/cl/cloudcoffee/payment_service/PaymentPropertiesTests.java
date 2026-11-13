package cl.cloudcoffee.payment_service;

import cl.cloudcoffee.payment_service.config.PaymentProperties;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class PaymentPropertiesTests {
    @Test
    void baseModuleCannotAccidentallyEnableAnUnimplementedProvider() {
        assertThatThrownBy(() -> properties("mercadopago_sandbox", Duration.ofSeconds(5)))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("INT2-111/112");
    }

    @Test
    void credentialsNeverAppearInConfigurationToString() {
        assertThat(properties("disabled", Duration.ofSeconds(5)).toString())
                .doesNotContain("secret-access-token", "secret-webhook");
    }

    @Test
    void negativeOrZeroTimeoutsAreRejected() {
        assertThatThrownBy(() -> properties("disabled", Duration.ZERO))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private PaymentProperties properties(String provider, Duration timeout) {
        return new PaymentProperties(provider, timeout, Duration.ofMinutes(5),
                "secret-access-token", "secret-webhook", null, null, null);
    }
}
