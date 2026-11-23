package cl.cloudcoffee.notification_service.email;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;

class ExternalSmtpConfigurationTest {

    @Test
    void aceptaCredencialesYEnlacesHttpsPublicos() {
        ExternalSmtpConfiguration configuration = new ExternalSmtpConfiguration(
                "smtp.example.net", "test-user", "test-password", "noreply@example.net",
                "https://web.example.net", "https://web.example.net/restablecer-contrasena");

        assertThatCode(configuration::validate).doesNotThrowAnyException();
    }

    @Test
    void rechazaCredencialesFaltantesYEnlacesLocales() {
        ExternalSmtpConfiguration missingCredentials = new ExternalSmtpConfiguration(
                "smtp.example.net", " ", "test-password", "noreply@example.net",
                "https://web.example.net", "https://web.example.net/restablecer-contrasena");
        ExternalSmtpConfiguration localLinks = new ExternalSmtpConfiguration(
                "smtp.example.net", "test-user", "test-password", "noreply@example.net",
                "http://localhost:3000", "https://web.example.net/restablecer-contrasena");
        ExternalSmtpConfiguration localSmtp = new ExternalSmtpConfiguration(
                "mailpit", "test-user", "test-password", "noreply@example.net",
                "https://web.example.net", "https://web.example.net/restablecer-contrasena");

        assertThatIllegalStateException().isThrownBy(missingCredentials::validate)
                .withMessageContaining("SMTP_USERNAME");
        assertThatIllegalStateException().isThrownBy(localLinks::validate)
                .withMessageContaining("FRONTEND_URL");
        assertThatIllegalStateException().isThrownBy(localSmtp::validate)
                .withMessageContaining("SMTP_HOST");
    }
}
