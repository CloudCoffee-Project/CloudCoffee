package cl.cloudcoffee.notification_service.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import cl.cloudcoffee.notification_service.devices.DevicePlatform;
import cl.cloudcoffee.notification_service.devices.DeviceToken;
import cl.cloudcoffee.notification_service.devices.DeviceTokenRepository;
import cl.cloudcoffee.notification_service.devices.DeviceTokenType;
import cl.cloudcoffee.notification_service.email.EmailService;
import cl.cloudcoffee.notification_service.history.NotificationHistory;
import cl.cloudcoffee.notification_service.history.NotificationHistoryRepository;
import cl.cloudcoffee.security.testing.ServiceJwtTests;

/** INT2-129: auth.usuario.anonimizado.v1 retira dispositivos y borra datos personales del historial. */
@SpringBootTest(properties = {"spring.rabbitmq.listener.simple.auto-startup=false",
        "management.health.rabbit.enabled=false", "management.health.mail.enabled=false"})
@AutoConfigureMockMvc
class CuentaAnonimizadaNotificationTest extends ServiceJwtTests {

    @Autowired NotificationEventConsumer consumer;
    @Autowired NotificationHistoryRepository historial;
    @Autowired DeviceTokenRepository dispositivos;
    @MockitoBean EmailService emailService;

    final UUID usuario = UUID.randomUUID();
    final UUID otro = UUID.randomUUID();

    @Test
    void removesDevicesAndPersonalDataButKeepsTheEventsAndOtherUsers() {
        dispositivo(usuario, DevicePlatform.ANDROID);
        dispositivo(usuario, DevicePlatform.IOS);
        DeviceToken ajeno = dispositivo(otro, DevicePlatform.ANDROID);
        NotificationHistory registro = evento("auth.verificacion.solicitud-correo.v1",
                Map.of("userId", usuario.toString(), "email", "ana@uct.cl"));
        NotificationHistory invitacion = evento("auth.personal.invitacion.v1",
                Map.of("usuarioId", usuario.toString(), "email", "ana@uct.cl", "nombre", "Ana", "rol", "CAJERO"));
        NotificationHistory deOtro = evento("auth.verificacion.solicitud-correo.v1",
                Map.of("userId", otro.toString(), "email", "otro@uct.cl"));

        CloudCoffeeEvent baja = baja(usuario.toString());
        consumer.consume(baja);

        assertThat(dispositivos.findAllByUserIdAndTokenType(usuario, DeviceTokenType.FCM)).isEmpty();
        assertThat(dispositivos.findById(ajeno.getId())).isPresent();
        assertThat(historial.findById(registro.getId()).orElseThrow().getPayload())
                .containsEntry("email", "[ELIMINADO]").containsEntry("userId", usuario.toString());
        assertThat(historial.findById(invitacion.getId()).orElseThrow().getPayload())
                .containsEntry("email", "[ELIMINADO]").containsEntry("nombre", "[ELIMINADO]")
                .containsEntry("rol", "CAJERO");
        assertThat(historial.findById(deOtro.getId()).orElseThrow().getPayload()).containsEntry("email", "otro@uct.cl");
        assertThat(historial.findByEventId(baja.eventId()).orElseThrow().getStatus()).isEqualTo("SUCCESS");

        // Repetir la entrega del mismo evento no cambia nada.
        consumer.consume(baja);
        assertThat(historial.findById(registro.getId()).orElseThrow().getPayload()).containsEntry("email", "[ELIMINADO]");
    }

    @Test
    void anEventWithoutAValidUserIsRejected() {
        CloudCoffeeEvent invalido = baja("no-es-uuid");
        assertThatThrownBy(() -> consumer.consume(invalido)).isInstanceOf(IllegalArgumentException.class);
        assertThat(historial.findByEventId(invalido.eventId()).orElseThrow().getStatus()).isEqualTo("FAILED");
    }

    private DeviceToken dispositivo(UUID dueno, DevicePlatform plataforma) {
        String token = "token-" + UUID.randomUUID();
        return dispositivos.saveAndFlush(new DeviceToken(token, UUID.randomUUID().toString().replace("-", ""),
                dueno, plataforma, DeviceTokenType.FCM, Instant.now()));
    }

    private NotificationHistory evento(String tipo, Map<String, Object> payload) {
        return historial.saveAndFlush(new NotificationHistory(UUID.randomUUID(), tipo, "trace", payload, "SUCCESS"));
    }

    private static CloudCoffeeEvent baja(String usuarioId) {
        return new CloudCoffeeEvent(UUID.randomUUID(), Instant.now(), "aabbccddeeff00112233445566778899",
                "auth.usuario.anonimizado.v1", Map.of("usuarioId", usuarioId, "rolAnterior", "CLIENTE",
                        "anonimizadoAt", Instant.now().toString(), "origen", "baja_propia"));
    }
}
