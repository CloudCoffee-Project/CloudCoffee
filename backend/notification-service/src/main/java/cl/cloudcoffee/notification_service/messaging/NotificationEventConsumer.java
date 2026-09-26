package cl.cloudcoffee.notification_service.messaging;

import cl.cloudcoffee.notification_service.email.EmailService;
import cl.cloudcoffee.notification_service.history.NotificationHistoryService;
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

        if (historyService.existsByEventId(event.eventId())) {
            LOGGER.info("Evento ya procesado (idempotencia): eventId={}, traceId={}", event.eventId(), event.traceId());
            return;
        }

        LOGGER.info("Procesando evento {}: eventId={}, traceId={}", event.eventType(), event.eventId(), event.traceId());

        try {
            switch (event.eventType()) {
                case "SolicitudVerificacionCorreo":
                    procesarVerificacionCorreo(event);
                    historyService.registerSuccess(event);
                    break;
                case "SolicitudRecuperacionPassword":
                    procesarRecuperacionPassword(event);
                    historyService.registerSuccess(event);
                    break;
                default:
                    LOGGER.info("Tipo de evento no manejado por este consumidor: {}", event.eventType());
                    historyService.registerSuccess(event);
                    break;
            }
        } catch (Exception e) {
            LOGGER.error("Error al procesar evento {}: {}", event.eventType(), e.getMessage(), e);
            historyService.registerFailure(event, e.getMessage() != null ? e.getMessage() : e.toString());
            // El mensaje se volverá a encolar según la configuración de reintentos
            throw e; 
        }
    }

    private void procesarVerificacionCorreo(CloudCoffeeEvent event) {
        String email = (String) event.payload().get("email");
        String token = (String) event.payload().get("token");
        
        LOGGER.info("-> Enviando correo de VERIFICACIÓN a {}. Token: {}", email, token);
        
        Context context = new Context();
        String verificacionUrl = frontendUrl + "/verificar-correo?token=" + token;
        context.setVariable("verificacionUrl", verificacionUrl);
        
        emailService.enviarCorreo(email, "Verifica tu cuenta en CloudCoffee", "verificacion", context);
    }

    private void procesarRecuperacionPassword(CloudCoffeeEvent event) {
        String email = (String) event.payload().get("email");
        String token = (String) event.payload().get("token");
        
        LOGGER.info("-> Enviando correo de RECUPERACIÓN a {}. Token: {}", email, token);
        
        Context context = new Context();
        String recuperacionUrl = frontendUrl + "/restaurar-contrasena?token=" + token;
        context.setVariable("recuperacionUrl", recuperacionUrl);
        
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