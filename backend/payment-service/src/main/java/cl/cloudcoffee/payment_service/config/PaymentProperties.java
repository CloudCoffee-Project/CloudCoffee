package cl.cloudcoffee.payment_service.config;

import java.net.URI;
import java.time.Duration;
import java.util.Locale;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Backend-only configuration. Never render credentials through generated toString().
 *
 * <p>INT2-111: {@code provider=mercadopago_sandbox} habilita la creación de preferencias. La URL de
 * checkout que se entrega (init_point o sandbox_init_point) sale de {@code checkoutMode}, validado contra
 * el tipo de credencial configurada; nunca se deduce del hostname de la respuesta.
 */
@ConfigurationProperties("cloudcoffee.payment")
public record PaymentProperties(String provider, Duration requestTimeout, Duration signatureTolerance,
        String accessToken, String webhookSecret, URI webhookPublicUrl, URI webReturnUrl, URI mobileReturnUrl,
        String checkoutMode, URI mercadopagoApiUrl, Duration reconciliationSettleTime) {

    public static final String DISABLED = "disabled";
    public static final String MERCADOPAGO_SANDBOX = "mercadopago_sandbox";
    /** Credenciales de producción de un usuario vendedor de prueba: el checkout es init_point. */
    public static final String MODE_TEST_USER = "test-user";
    /** Credenciales de prueba (prefijo TEST-): el checkout es sandbox_init_point. */
    public static final String MODE_TEST_CREDENTIALS = "test-credentials";

    public PaymentProperties {
        if (!DISABLED.equals(provider) && !MERCADOPAGO_SANDBOX.equals(provider)) {
            throw new IllegalArgumentException("Payment provider must be disabled or mercadopago_sandbox");
        }
        positive(requestTimeout, "request-timeout");
        positive(signatureTolerance, "signature-tolerance");
        if (reconciliationSettleTime == null) reconciliationSettleTime = Duration.ofMinutes(1);
        positive(reconciliationSettleTime, "reconciliation-settle-time");
        if (mercadopagoApiUrl == null) mercadopagoApiUrl = URI.create("https://api.mercadopago.com");
        checkoutMode = checkoutMode == null ? "" : checkoutMode.trim().toLowerCase(Locale.ROOT);
        if (MERCADOPAGO_SANDBOX.equals(provider)) {
            validateSandbox(accessToken, checkoutMode, webReturnUrl, mobileReturnUrl, webhookPublicUrl,
                    mercadopagoApiUrl);
            // Si se anuncia notification_url al proveedor, debe existir el secreto para verificar sus firmas.
            if (webhookPublicUrl != null && !webhookPublicUrl.toString().isBlank()
                    && (webhookSecret == null || webhookSecret.isBlank())) {
                throw new IllegalArgumentException(
                        "MERCADOPAGO_WEBHOOK_SECRET is required when PAYMENT_WEBHOOK_PUBLIC_URL is set");
            }
        }
    }

    public boolean enabled() {
        return MERCADOPAGO_SANDBOX.equals(provider);
    }

    /** INT2-112: sin secreto el webhook falla cerrado (503) en vez de aceptar notificaciones sin verificar. */
    public boolean webhookEnabled() {
        return enabled() && webhookSecret != null && !webhookSecret.isBlank();
    }

    public boolean usesSandboxInitPoint() {
        return MODE_TEST_CREDENTIALS.equals(checkoutMode);
    }

    private static void validateSandbox(String token, String mode, URI web, URI mobile, URI webhook, URI api) {
        if (token == null || token.isBlank()) {
            throw new IllegalArgumentException("MERCADOPAGO_ACCESS_TOKEN is required for mercadopago_sandbox");
        }
        // La modalidad declarada debe coincidir con la credencial: así no se entrega por error el checkout
        // de otro entorno. El valor del token jamás se incluye en el mensaje.
        switch (mode) {
            case MODE_TEST_CREDENTIALS -> {
                if (!token.startsWith("TEST-")) {
                    throw new IllegalArgumentException("PAYMENT_CHECKOUT_MODE=test-credentials requires a TEST- access token");
                }
            }
            case MODE_TEST_USER -> {
                if (!token.startsWith("APP_USR-")) {
                    throw new IllegalArgumentException("PAYMENT_CHECKOUT_MODE=test-user requires the APP_USR- token of a test seller account");
                }
            }
            default -> throw new IllegalArgumentException("PAYMENT_CHECKOUT_MODE must be test-user or test-credentials");
        }
        requireHttpsBase(web, "PAYMENT_WEB_RETURN_URL");
        requireHttpsBase(mobile, "PAYMENT_MOBILE_RETURN_URL");
        if (webhook != null && !webhook.toString().isBlank()) requireHttpsBase(webhook, "PAYMENT_WEBHOOK_PUBLIC_URL");
        requireHttpsBase(api, "MERCADOPAGO_API_URL");
    }

    /** Bases confiables: HTTPS absoluto, sin credenciales, query ni fragmento (Payment agrega la correlación). */
    private static void requireHttpsBase(URI uri, String name) {
        if (uri == null || !uri.isAbsolute() || !"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null) {
            throw new IllegalArgumentException(name + " must be an absolute HTTPS URL without query, fragment or user info");
        }
    }

    private static void positive(Duration value, String name) {
        if (value == null || value.isNegative() || value.isZero()) {
            throw new IllegalArgumentException("Payment " + name + " must be a positive duration");
        }
    }

    @Override
    public String toString() {
        return "PaymentProperties[provider=" + provider + ", checkoutMode=" + checkoutMode + "]";
    }
}
