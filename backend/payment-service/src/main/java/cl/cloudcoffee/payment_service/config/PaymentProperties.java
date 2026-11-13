package cl.cloudcoffee.payment_service.config;

import java.net.URI;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** Backend-only configuration. Never render credentials through generated toString(). */
@ConfigurationProperties("cloudcoffee.payment")
public record PaymentProperties(String provider, Duration requestTimeout, Duration signatureTolerance,
        String accessToken, String webhookSecret, URI webhookPublicUrl, URI webReturnUrl, URI mobileReturnUrl) {
    public PaymentProperties {
        if (!"disabled".equals(provider)) {
            throw new IllegalArgumentException(
                    "Payment provider must remain disabled until INT2-111/112 implement the verified adapter");
        }
        if (requestTimeout == null || requestTimeout.isNegative() || requestTimeout.isZero()
                || signatureTolerance == null || signatureTolerance.isNegative() || signatureTolerance.isZero()) {
            throw new IllegalArgumentException("Payment timeouts must be positive durations");
        }
    }

    @Override
    public String toString() {
        return "PaymentProperties[provider=" + provider + "]";
    }
}
