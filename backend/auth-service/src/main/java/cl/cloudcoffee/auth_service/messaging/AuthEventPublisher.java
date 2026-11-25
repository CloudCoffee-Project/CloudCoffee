package cl.cloudcoffee.auth_service.messaging;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;

@Component
public class AuthEventPublisher {

    public static final String USER_REGISTERED_EVENT =
            "auth.user.registered.v1";

    public static final String SOLICITUD_VERIFICACION_CORREO_EVENT =
            "auth.verificacion.solicitud-correo.v1";
    public static final String SOLICITUD_RECUPERACION_PASSWORD_EVENT =
            "auth.recuperacion.solicitud-password.v1";
    public static final String INVITACION_PERSONAL_EVENT = "auth.personal.invitacion.v1";
    public static final String USUARIO_ANONIMIZADO_EVENT = "auth.usuario.anonimizado.v1";

    private final RabbitTemplate rabbitTemplate;

    public AuthEventPublisher(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    public CloudCoffeeEvent publishUserRegistered(
            String userId,
            String email,
            String traceId
    ) {
        CloudCoffeeEvent event = new CloudCoffeeEvent(
                UUID.randomUUID(),
                Instant.now(),
                traceId,
                USER_REGISTERED_EVENT,
                Map.of(
                        "userId", userId,
                        "email", email
                )
        );

        rabbitTemplate.convertAndSend(
                RabbitTopologyConfig.EVENTS_EXCHANGE,
                USER_REGISTERED_EVENT,
                event
        );

        return event;
    }

    public CloudCoffeeEvent publishSolicitudVerificacionCorreo(
            String userId,
            String email,
            String token,
            Instant expiresAt,
            String traceId
    ) {
        CloudCoffeeEvent event = new CloudCoffeeEvent(
                UUID.randomUUID(),
                Instant.now(),
                traceId,
                SOLICITUD_VERIFICACION_CORREO_EVENT,
                Map.of(
                        "userId", userId,
                        "email", email,
                        "token", token,
                        "expiresAt", expiresAt.toString()
                )
        );

        rabbitTemplate.convertAndSend(
                RabbitTopologyConfig.EVENTS_EXCHANGE,
                SOLICITUD_VERIFICACION_CORREO_EVENT,
                event
        );

        return event;
    }
    public CloudCoffeeEvent publishSolicitudRecuperacionPassword(
            String userId,
            String email,
            String token,
            Instant expiresAt,
            String traceId) {
        CloudCoffeeEvent event = new CloudCoffeeEvent(
                UUID.randomUUID(),
                Instant.now(),
                traceId,
                SOLICITUD_RECUPERACION_PASSWORD_EVENT,
                Map.of("userId", userId, "email", email, "token", token, "expiresAt", expiresAt.toString())
        );

        rabbitTemplate.convertAndSend(RabbitTopologyConfig.EVENTS_EXCHANGE,
                SOLICITUD_RECUPERACION_PASSWORD_EVENT, event);
        return event;
    }

    /** INT2-121 (contrato INT2-109): Notification envía el enlace de activación al personal invitado. */
    public CloudCoffeeEvent publishInvitacionPersonal(String usuarioId, String email, String nombre, String rol,
            String cafeteriaId, String token, Instant expiresAt, String traceId) {
        CloudCoffeeEvent event = new CloudCoffeeEvent(UUID.randomUUID(), Instant.now(), traceId,
                INVITACION_PERSONAL_EVENT,
                Map.of("usuarioId", usuarioId, "email", email, "nombre", nombre, "rol", rol,
                        "cafeteriaId", cafeteriaId, "token", token, "expiresAt", expiresAt.toString()));
        rabbitTemplate.convertAndSend(RabbitTopologyConfig.EVENTS_EXCHANGE, INVITACION_PERSONAL_EVENT, event);
        return event;
    }

    /** INT2-121: la cuenta se anonimizó; no lleva datos personales, solo el id pseudónimo. */
    public CloudCoffeeEvent publishUsuarioAnonimizado(String usuarioId, String rolAnterior, Instant anonimizadoAt,
            String origen, String traceId) {
        CloudCoffeeEvent event = new CloudCoffeeEvent(UUID.randomUUID(), Instant.now(), traceId,
                USUARIO_ANONIMIZADO_EVENT,
                Map.of("usuarioId", usuarioId, "rolAnterior", rolAnterior,
                        "anonimizadoAt", anonimizadoAt.toString(), "origen", origen));
        rabbitTemplate.convertAndSend(RabbitTopologyConfig.EVENTS_EXCHANGE, USUARIO_ANONIMIZADO_EVENT, event);
        return event;
    }
}
