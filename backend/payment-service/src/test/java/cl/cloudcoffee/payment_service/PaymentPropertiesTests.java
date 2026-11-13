package cl.cloudcoffee.payment_service;

import cl.cloudcoffee.payment_service.config.PaymentProperties;
import java.net.URI;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.assertj.core.api.Assertions.*;

class PaymentPropertiesTests {
    static final URI WEB = URI.create("https://app.cloudcoffee.test/pagos/retorno");
    static final URI MOBILE = URI.create("https://app.cloudcoffee.test/mobile/pagos/retorno");

    @Test
    void onlyDisabledOrTheSandboxAdapterCanBeConfigured() {
        assertThatThrownBy(() -> properties("mercadopago", "APP_USR-x", "test-user", WEB, MOBILE))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> properties("simulado", "APP_USR-x", "test-user", WEB, MOBILE))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(properties("disabled", "", "", null, null).enabled()).isFalse();
    }

    @Test
    void sandboxRequiresCredentialAndACheckoutModeConsistentWithIt() {
        assertThatThrownBy(() -> properties("mercadopago_sandbox", "", "test-user", WEB, MOBILE))
                .hasMessageContaining("MERCADOPAGO_ACCESS_TOKEN");
        assertThatThrownBy(() -> properties("mercadopago_sandbox", "APP_USR-x", "", WEB, MOBILE))
                .hasMessageContaining("PAYMENT_CHECKOUT_MODE");
        // La modalidad declarada debe coincidir con la credencial; nunca se deduce de la URL devuelta.
        assertThatThrownBy(() -> properties("mercadopago_sandbox", "APP_USR-x", "test-credentials", WEB, MOBILE))
                .hasMessageContaining("TEST-");
        assertThatThrownBy(() -> properties("mercadopago_sandbox", "TEST-x", "test-user", WEB, MOBILE))
                .hasMessageContaining("APP_USR-");
        assertThat(properties("mercadopago_sandbox", "TEST-x", "test-credentials", WEB, MOBILE).usesSandboxInitPoint()).isTrue();
        assertThat(properties("mercadopago_sandbox", "APP_USR-x", "TEST-USER", WEB, MOBILE).usesSandboxInitPoint()).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"http://app.cloudcoffee.test/retorno", "https://app.cloudcoffee.test/retorno?next=https://evil.test",
            "https://app.cloudcoffee.test/retorno#x", "https://user@app.cloudcoffee.test/retorno", "/relativa",
            "cloudcoffee://pagos"})
    void returnUrlsMustBeTrustedHttpsBases(String url) {
        assertThatThrownBy(() -> properties("mercadopago_sandbox", "APP_USR-x", "test-user", URI.create(url), MOBILE))
                .hasMessageContaining("PAYMENT_WEB_RETURN_URL");
        assertThatThrownBy(() -> properties("mercadopago_sandbox", "APP_USR-x", "test-user", WEB, URI.create(url)))
                .hasMessageContaining("PAYMENT_MOBILE_RETURN_URL");
    }

    @Test
    void credentialsNeverAppearInConfigurationToString() {
        assertThat(properties("mercadopago_sandbox", "APP_USR-secret-access-token", "test-user", WEB, MOBILE).toString())
                .doesNotContain("secret-access-token", "secret-webhook");
    }

    @Test
    void credentialValueIsNeverPartOfValidationErrors() {
        assertThatThrownBy(() -> properties("mercadopago_sandbox", "APP_USR-secret-access-token", "test-credentials", WEB, MOBILE))
                .message().doesNotContain("secret-access-token");
    }

    @Test
    void negativeOrZeroTimeoutsAreRejected() {
        assertThatThrownBy(() -> new PaymentProperties("disabled", Duration.ZERO, Duration.ofMinutes(5),
                "", "", null, null, null, "", null, null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new PaymentProperties("disabled", Duration.ofSeconds(5), Duration.ofMinutes(5),
                "", "", null, null, null, "", null, Duration.ZERO)).isInstanceOf(IllegalArgumentException.class);
    }

    private PaymentProperties properties(String provider, String token, String mode, URI web, URI mobile) {
        return new PaymentProperties(provider, Duration.ofSeconds(5), Duration.ofMinutes(5),
                token, "secret-webhook", null, web, mobile, mode, null, null);
    }
}
