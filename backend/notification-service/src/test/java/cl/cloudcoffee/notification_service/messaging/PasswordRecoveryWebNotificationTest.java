package cl.cloudcoffee.notification_service.messaging;

import cl.cloudcoffee.notification_service.email.EmailService;
import cl.cloudcoffee.security.testing.ServiceJwtTests;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.thymeleaf.TemplateEngine;
import org.thymeleaf.context.Context;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;

@SpringBootTest(properties = {
        "spring.rabbitmq.listener.simple.auto-startup=false",
        "app.password-reset.url=https://web.cloudcoffee.example/restablecer-contrasena",
        "management.health.rabbit.enabled=false",
        "management.health.mail.enabled=false"
})
@AutoConfigureMockMvc
class PasswordRecoveryWebNotificationTest extends ServiceJwtTests {

    @Autowired NotificationEventConsumer consumer;
    @Autowired TemplateEngine templateEngine;
    @MockitoBean EmailService emailService;

    @Test
    void correoAbreLaUrlWebConfiguradaYConservaElTokenCodificado() {
        CloudCoffeeEvent event = new CloudCoffeeEvent(UUID.randomUUID(), Instant.now(), "trace-web-recovery",
                "auth.recuperacion.solicitud-password.v1", Map.of(
                        "userId", "user-web",
                        "email", "web@cloudcoffee.cl",
                        "token", "token+con/simbolos=",
                        "expiresAt", Instant.now().plusSeconds(3600).toString()));

        consumer.consume(event);

        ArgumentCaptor<Context> context = ArgumentCaptor.forClass(Context.class);
        verify(emailService).enviarCorreo(eq("web@cloudcoffee.cl"),
                eq("Recuperación de contraseña - CloudCoffee"), eq("recuperacion"), context.capture());
        String expectedUrl = "https://web.cloudcoffee.example/restablecer-contrasena?token=token%2Bcon%2Fsimbolos%3D";
        assertThat(context.getValue().getVariable("recuperacionUrl")).isEqualTo(expectedUrl);
        assertThat(templateEngine.process("recuperacion", context.getValue()))
                .contains("href=\"" + expectedUrl + "\"");
    }
}
