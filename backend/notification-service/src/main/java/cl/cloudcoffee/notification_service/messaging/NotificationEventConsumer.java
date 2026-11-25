package cl.cloudcoffee.notification_service.messaging;

import cl.cloudcoffee.notification_service.email.EmailService;
import cl.cloudcoffee.notification_service.history.CuentaAnonimizadaService;
import cl.cloudcoffee.notification_service.history.NotificationHistoryService;
import cl.cloudcoffee.notification_service.push.NotificationPushService;
import cl.cloudcoffee.notification_service.websocket.NotificationWebSocketPublisher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.util.UriComponentsBuilder;
import org.thymeleaf.context.Context;

@Component
public class NotificationEventConsumer {

    private static final Logger LOGGER = LoggerFactory.getLogger(NotificationEventConsumer.class);

    private final NotificationHistoryService historyService;
    private final EmailService emailService;
    private final NotificationWebSocketPublisher webSocketPublisher;
    private final NotificationPushService pushService;
    private final CuentaAnonimizadaService cuentasAnonimizadas;

    @Value("${app.frontend.url}")
    private String frontendUrl;

    @Value("${app.password-reset.url}")
    private String passwordResetUrl;

    public NotificationEventConsumer(
            NotificationHistoryService historyService,
            EmailService emailService,
            NotificationWebSocketPublisher webSocketPublisher,
            NotificationPushService pushService,
            CuentaAnonimizadaService cuentasAnonimizadas
    ) {
        this.historyService = historyService;
        this.emailService = emailService;
        this.webSocketPublisher = webSocketPublisher;
        this.pushService = pushService;
        this.cuentasAnonimizadas = cuentasAnonimizadas;
    }

    @Transactional
    @RabbitListener(
            queues = RabbitTopologyConfig.NOTIFICATION_EVENTS_QUEUE
    )
    public void consume(CloudCoffeeEvent event) {
        validate(event);

        if (historyService.wasSuccessful(event.eventId())) {
            LOGGER.info("Evento ya procesado (idempotencia): eventId={}, traceId={}", event.eventId(), event.traceId());
            return;
        }

        LOGGER.info("Procesando evento {}: eventId={}, traceId={}", event.eventType(), event.eventId(), event.traceId());

        try {
            switch (event.eventType()) {
                case "auth.verificacion.solicitud-correo.v1":
                    procesarVerificacionCorreo(event);
                    historyService.registerSuccess(event);
                    break;
                case "auth.recuperacion.solicitud-password.v1":
                    procesarRecuperacionPassword(event);
                    historyService.registerSuccess(event);
                    break;
                case "auth.usuario.anonimizado.v1":
                    procesarCuentaAnonimizada(event);
                    historyService.registerSuccess(event);
                    break;
                case "auth.personal.invitacion.v1":
                    procesarInvitacionPersonal(event);
                    historyService.registerSuccess(event);
                    break;
                case "order.compra.creada.v1":
                case "order.compra.estado-cambiado.v1":
                case "order.pago.resultado.v1":
                case "order.orden.estado-cambiado.v1":
                case "order.orden.entregada.v1":
                    webSocketPublisher.publish(event);
                    pushService.enqueueOrderEvent(event);
                    historyService.registerSuccess(event);
                    break;
                case "catalog.stock.actualizado.v1":
                    webSocketPublisher.publish(event);
                    historyService.registerSuccess(event);
                    break;
                case "catalog.producto.disponible.v1":
                    pushService.enqueueRestockEvent(event);
                    historyService.registerSuccess(event);
                    break;
                default:
                    LOGGER.info("Tipo de evento no manejado por este consumidor: {}", event.eventType());
                    historyService.registerSuccess(event);
                    break;
            }
        } catch (Exception e) {
            LOGGER.error("Error al procesar evento {}: eventId={}, traceId={}",
                    event.eventType(), event.eventId(), event.traceId());
            historyService.registerFailure(event, e.getMessage() != null ? e.getMessage() : e.toString());
            // El mensaje se volverá a encolar según la configuración de reintentos
            throw e;
        }
    }

    private void procesarVerificacionCorreo(CloudCoffeeEvent event) {
        String email = (String) event.payload().get("email");
        String token = (String) event.payload().get("token");

        LOGGER.info("Enviando correo de verificación a {}", email);

        Context context = new Context();
        String verificacionUrl = UriComponentsBuilder.fromUriString(frontendUrl)
                .pathSegment("verificar-correo")
                .queryParam("token", "{token}")
                .encode()
                .buildAndExpand(token)
                .toUriString();
        context.setVariable("verificacionUrl", verificacionUrl);
        context.setVariable("token", token);

        emailService.enviarCorreo(email, "Verifica tu cuenta en CloudCoffee", "verificacion", context);
    }

    private void procesarRecuperacionPassword(CloudCoffeeEvent event) {
        String email = (String) event.payload().get("email");
        String token = (String) event.payload().get("token");

        LOGGER.info("Enviando correo de recuperación a {}", email);

        Context context = new Context();
        String recuperacionUrl = UriComponentsBuilder.fromUriString(passwordResetUrl)
                .queryParam("token", "{token}")
                .encode()
                .buildAndExpand(token)
                .toUriString();
        context.setVariable("recuperacionUrl", recuperacionUrl);
        context.setVariable("token", token);

        emailService.enviarCorreo(email, "Recuperación de contraseña - CloudCoffee", "recuperacion", context);
    }

    /** INT2-129: retira los dispositivos de la cuenta y borra sus datos personales del historial. */
    private void procesarCuentaAnonimizada(CloudCoffeeEvent event) {
        java.util.UUID usuarioId;
        try {
            usuarioId = java.util.UUID.fromString(String.valueOf(event.payload().get("usuarioId")));
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("La baja no contiene un usuarioId válido");
        }
        var resultado = cuentasAnonimizadas.aplicar(usuarioId);
        LOGGER.info("Cuenta anonimizada: eventId={}, dispositivos={}, eventos={}", event.eventId(),
                resultado.dispositivos(), resultado.eventos());
    }

    /** INT2-121: enlace de activación del personal invitado; la persona define su propia contraseña. */
    private void procesarInvitacionPersonal(CloudCoffeeEvent event) {
        String email = (String) event.payload().get("email");
        String token = (String) event.payload().get("token");
        if (email == null || email.isBlank() || token == null || token.isBlank()) {
            throw new IllegalArgumentException("La invitación no contiene correo o token");
        }

        LOGGER.info("Enviando invitación de personal: eventId={}", event.eventId());

        Context context = new Context();
        String activacionUrl = UriComponentsBuilder.fromUriString(frontendUrl)
                .pathSegment("activar-cuenta")
                .queryParam("token", "{token}")
                .encode()
                .buildAndExpand(token)
                .toUriString();
        context.setVariable("activacionUrl", activacionUrl);
        context.setVariable("token", token);
        context.setVariable("nombre", event.payload().get("nombre"));
        context.setVariable("rol", "ADMIN_CAFETERIA".equals(event.payload().get("rol"))
                ? "administrador de cafetería" : "cajero");

        emailService.enviarCorreo(email, "Te invitaron a CloudCoffee", "invitacion", context);
    }

    private void validate(CloudCoffeeEvent event) {
        if (event == null
                || event.eventId() == null
                || event.timestamp() == null
                || event.traceId() == null
                || event.traceId().isBlank()
                || event.eventType() == null
                || event.eventType().isBlank()
                || event.payload() == null) {
            throw new IllegalArgumentException(
                    "El evento no contiene los datos obligatorios"
            );
        }
    }
}
