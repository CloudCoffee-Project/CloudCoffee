package cl.cloudcoffee.notification_service.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import java.time.Instant;
import java.util.HashMap;
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

import cl.cloudcoffee.notification_service.email.EmailService;
import cl.cloudcoffee.notification_service.history.NotificationHistory;
import cl.cloudcoffee.notification_service.history.NotificationHistoryRepository;
import cl.cloudcoffee.security.testing.ServiceJwtTests;

/** INT2-121: correo con el enlace de activación del personal invitado (auth.personal.invitacion.v1). */
@SpringBootTest(properties = {"spring.rabbitmq.listener.simple.auto-startup=false",
        "app.frontend.url=https://cloudcoffee.test",
        "management.health.rabbit.enabled=false", "management.health.mail.enabled=false"})
@AutoConfigureMockMvc
class InvitacionPersonalNotificationTest extends ServiceJwtTests {

    static final String TOKEN = "q8Yt3rU1oP0aZx9Lk2mN4bV6cX7zA5sD1fG3hJ8kL0w";

    @Autowired NotificationEventConsumer consumer;
    @Autowired NotificationHistoryRepository repository;
    @Autowired TemplateEngine templateEngine;
    @MockitoBean EmailService emailService;

    private CloudCoffeeEvent invitacion(Map<String, Object> cambios) {
        Map<String, Object> payload = new HashMap<>(Map.of("usuarioId", UUID.randomUUID().toString(),
                "email", "cajera.nueva@uct.cl", "nombre", "Ana", "rol", "ADMIN_CAFETERIA",
                "cafeteriaId", "44444444-4444-4444-8444-444444444444", "token", TOKEN,
                "expiresAt", Instant.now().plusSeconds(72 * 3600).toString()));
        payload.putAll(cambios);
        return new CloudCoffeeEvent(UUID.randomUUID(), Instant.now(), "aabbccddeeff00112233445566778899",
                "auth.personal.invitacion.v1", payload);
    }

    @Test
    void sendsTheActivationLinkOnceAndNeverStoresTheToken() {
        CloudCoffeeEvent evento = invitacion(Map.of());
        consumer.consume(evento);
        consumer.consume(evento);

        ArgumentCaptor<Context> context = ArgumentCaptor.forClass(Context.class);
        verify(emailService, times(1)).enviarCorreo(eq("cajera.nueva@uct.cl"), any(), eq("invitacion"),
                context.capture());
        assertThat(context.getValue().getVariable("activacionUrl"))
                .isEqualTo("https://cloudcoffee.test/activar-cuenta?token=" + TOKEN);
        String html = templateEngine.process("invitacion", context.getValue());
        assertThat(html).contains("Ana", "administrador de cafetería", TOKEN, "72 horas")
                .doesNotContainIgnoringCase("contraseña es");

        NotificationHistory historial = repository.findByEventId(evento.eventId()).orElseThrow();
        assertThat(historial.getStatus()).isEqualTo("SUCCESS");
        assertThat(historial.getPayload()).doesNotContainKey("token");
    }

    @Test
    void anInvitationWithoutTokenIsRejectedWithoutSendingMail() {
        CloudCoffeeEvent evento = invitacion(Map.of("token", " "));
        assertThatThrownBy(() -> consumer.consume(evento)).isInstanceOf(IllegalArgumentException.class);
        verify(emailService, never()).enviarCorreo(any(), any(), any(), any());
        assertThat(repository.findByEventId(evento.eventId()).orElseThrow().getStatus()).isEqualTo("FAILED");
    }
}
