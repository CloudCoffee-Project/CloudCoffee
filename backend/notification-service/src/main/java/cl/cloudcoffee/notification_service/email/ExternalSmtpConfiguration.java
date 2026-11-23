package cl.cloudcoffee.notification_service.email;

import jakarta.annotation.PostConstruct;
import java.net.URI;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

@Component
@Profile("smtp-external")
public class ExternalSmtpConfiguration {

    private final String host;
    private final String username;
    private final String password;
    private final String from;
    private final String verificationUrl;
    private final String passwordResetUrl;

    public ExternalSmtpConfiguration(
            @Value("${spring.mail.host:}") String host,
            @Value("${spring.mail.username:}") String username,
            @Value("${spring.mail.password:}") String password,
            @Value("${app.mail.from:}") String from,
            @Value("${app.frontend.url:}") String verificationUrl,
            @Value("${app.password-reset.url:}") String passwordResetUrl
    ) {
        this.host = host;
        this.username = username;
        this.password = password;
        this.from = from;
        this.verificationUrl = verificationUrl;
        this.passwordResetUrl = passwordResetUrl;
    }

    @PostConstruct
    void validate() {
        requireConfigured(host, "SMTP_HOST");
        if (host.equalsIgnoreCase("localhost") || host.equalsIgnoreCase("mailpit")) {
            throw new IllegalStateException("SMTP_HOST debe identificar un servidor SMTP externo");
        }
        requireConfigured(username, "SMTP_USERNAME");
        requireConfigured(password, "SMTP_PASSWORD");
        requireConfigured(from, "SMTP_FROM");
        requirePublicHttps(verificationUrl, "FRONTEND_URL");
        requirePublicHttps(passwordResetUrl, "RESET_PASSWORD_URL");
    }

    private static void requireConfigured(String value, String variable) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(variable + " es obligatorio con el perfil smtp-external");
        }
    }

    private static void requirePublicHttps(String value, String variable) {
        try {
            URI uri = URI.create(value);
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null
                    || host.equalsIgnoreCase("localhost") || host.endsWith(".local")) {
                throw new IllegalStateException(variable + " debe ser una URL pública HTTPS");
            }
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException(variable + " debe ser una URL pública HTTPS", exception);
        }
    }
}
