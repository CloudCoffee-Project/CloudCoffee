package cl.cloudcoffee.notification_service.messaging;

import cl.cloudcoffee.notification_service.email.EmailService;
import cl.cloudcoffee.notification_service.history.NotificationHistoryService;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.thymeleaf.context.Context;

@Component
public class NotificationEventConsumer {

    private static final Logger LOGGER = LoggerFactory.getLogger(NotificationEventConsumer.class);

    private final NotificationHistoryService historyService;
    private final EmailService emailService;

    @Value("${app.frontend.url:http://localhost:8081}")
    private String frontendUrl;

    @Value("${app.password-reset.url:mobile://restaurar-contrasena}")
    private String passwordResetUrl;

    public NotificationEventConsumer(
            NotificationHistoryService historyService,
            EmailService emailService
    ) {
        this.historyService = historyService;
        this.emailService = emailService;
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
        String verificacionUrl = frontendUrl + "/verificar-correo?token=" + token;
        context.setVariable("verificacionUrl", verificacionUrl);

        emailService.enviarCorreo(email, "Verifica tu cuenta en CloudCoffee", "verificacion", context);
    }

    private void procesarRecuperacionPassword(CloudCoffeeEvent event) {
        String email = (String) event.payload().get("email");
        String token = (String) event.payload().get("token");

        LOGGER.info("Enviando correo de recuperación a {}", email);

        Context context = new Context();
        String recuperacionUrl = passwordResetUrl + "?token="
                + URLEncoder.encode(token, StandardCharsets.UTF_8);
        context.setVariable("recuperacionUrl", recuperacionUrl);
        context.setVariable("token", token);

        emailService.enviarCorreo(email, "Recuperación de contraseña - CloudCoffee", "recuperacion", context);
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
