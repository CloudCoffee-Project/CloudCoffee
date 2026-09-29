package cl.cloudcoffee.notification_service.messaging;

import cl.cloudcoffee.notification_service.email.EmailService;
import cl.cloudcoffee.notification_service.history.NotificationHistory;
import cl.cloudcoffee.notification_service.history.NotificationHistoryRepository;
import cl.cloudcoffee.notification_service.notifications.NotificationHistoryResponse;
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
import org.springframework.test.util.ReflectionTestUtils;
import org.thymeleaf.TemplateEngine;
import org.thymeleaf.context.Context;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@SpringBootTest(properties = {"spring.rabbitmq.listener.simple.auto-startup=false",
        "app.password-reset.url=mobile://restaurar-contrasena",
        "management.health.rabbit.enabled=false", "management.health.mail.enabled=false"})
@AutoConfigureMockMvc
class PasswordRecoveryNotificationTest extends ServiceJwtTests {

    @Autowired NotificationEventConsumer consumer;
    @Autowired NotificationHistoryRepository repository;
    @Autowired TemplateEngine templateEngine;
    @MockitoBean EmailService emailService;

    private CloudCoffeeEvent event(String type, String token) {
        return new CloudCoffeeEvent(UUID.randomUUID(), Instant.now(), "trace-recovery", type,
                Map.of("userId", "user-1", "email", "user@cloudcoffee.cl", "token", token,
                        "expiresAt", Instant.now().plusSeconds(3600).toString()));
    }

    @Test
    void enviaCorreoConEnlaceMovilYAseguraElHistorial() {
        CloudCoffeeEvent event = event("auth.recuperacion.solicitud-password.v1", "token-secreto");
        consumer.consume(event);
        consumer.consume(event);

        ArgumentCaptor<Context> context = ArgumentCaptor.forClass(Context.class);
        verify(emailService, times(1)).enviarCorreo(eq("user@cloudcoffee.cl"), any(),
                eq("recuperacion"), context.capture());
        assertThat(context.getValue().getVariable("recuperacionUrl"))
                .isEqualTo("mobile://restaurar-contrasena?token=token-secreto");
        assertThat(templateEngine.process("recuperacion", context.getValue()))
                .contains("token-secreto", "expiran en una hora");

        NotificationHistory history = repository.findByEventId(event.eventId()).orElseThrow();
        assertThat(history.getStatus()).isEqualTo("SUCCESS");
        assertThat(history.getPayload()).doesNotContainKey("token");
        assertThat(history.getPayload()).containsEntry("email", "user@cloudcoffee.cl");
    }

    @Test
    void reconoceTambienElEventoDeVerificacion() {
        CloudCoffeeEvent event = event("auth.verificacion.solicitud-correo.v1", "codigo-secreto");
        consumer.consume(event);
        verify(emailService).enviarCorreo(eq("user@cloudcoffee.cl"), any(), eq("verificacion"), any());
        assertThat(repository.findByEventId(event.eventId()).orElseThrow().getStatus()).isEqualTo("SUCCESS");
    }

    @Test
    void auditaElFalloSinFiltrarTokenYPermiteReintentar() {
        CloudCoffeeEvent event = event("auth.recuperacion.solicitud-password.v1", "token-secreto");
        doThrow(new IllegalStateException("SMTP rechazó token-secreto"))
                .doNothing().when(emailService).enviarCorreo(any(), any(), any(), any());

        assertThatThrownBy(() -> consumer.consume(event)).isInstanceOf(IllegalStateException.class);
        NotificationHistory failure = repository.findByEventId(event.eventId()).orElseThrow();
        assertThat(failure.getStatus()).isEqualTo("FAILED");
        assertThat(failure.getPayload()).doesNotContainKey("token");
        assertThat(failure.getErrorDetail()).doesNotContain("token-secreto");

        consumer.consume(event);
        assertThat(repository.findByEventId(event.eventId()).orElseThrow().getStatus()).isEqualTo("SUCCESS");
        verify(emailService, times(2)).enviarCorreo(any(), any(), any(), any());
    }

    @Test
    void respuestaDelHistorialOcultaTokensPersistidosAnteriormente() {
        NotificationHistory old = new NotificationHistory(UUID.randomUUID(),
                "auth.recuperacion.solicitud-password.v1", "trace", Map.of("email", "user@cloudcoffee.cl"),
                "FAILED", "Error con token-antiguo");
        ReflectionTestUtils.setField(old, "payload", Map.of("email", "user@cloudcoffee.cl",
                "token", "token-antiguo"));
        NotificationHistoryResponse response = NotificationHistoryResponse.from(old);
        assertThat(response.payload()).doesNotContainKey("token");
        assertThat(response.errorDetail()).doesNotContain("token-antiguo");
    }
}
