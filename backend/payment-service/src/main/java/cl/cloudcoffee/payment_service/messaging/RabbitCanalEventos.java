package cl.cloudcoffee.payment_service.messaging;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import org.springframework.amqp.AmqpException;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;

/**
 * Publicación con publisher confirms y {@code mandatory} (application.yml): el evento solo se da por entregado si
 * el broker lo confirmó y no lo devolvió por falta de ruta. El messageId es el eventId estable del outbox.
 */
@Component
public class RabbitCanalEventos implements CanalEventos {

    private static final Duration CONFIRMACION = Duration.ofSeconds(5);

    private final RabbitTemplate rabbit;

    public RabbitCanalEventos(RabbitTemplate rabbit) {
        this.rabbit = rabbit;
    }

    @Override
    public Envio enviar(String exchange, String routingKey, UUID eventId, String cuerpo, String motivoDlq) {
        var builder = MessageBuilder.withBody(cuerpo.getBytes(StandardCharsets.UTF_8))
                .setContentType(MessageProperties.CONTENT_TYPE_JSON).setContentEncoding("UTF-8")
                .setDeliveryMode(MessageDeliveryMode.PERSISTENT).setMessageId(eventId.toString())
                .setType(PaymentMessagingConfiguration.PAYMENT_RESULT);
        if (motivoDlq != null) builder.setHeader("x-cloudcoffee-error", motivoDlq);
        var correlation = new CorrelationData(eventId.toString());
        try {
            rabbit.send(exchange, routingKey, builder.build(), correlation);
            var confirm = correlation.getFuture().get(CONFIRMACION.toMillis(), TimeUnit.MILLISECONDS);
            if (!confirm.ack()) return Envio.fallo("RECHAZADO");
            if (correlation.getReturned() != null) return Envio.fallo("SIN_RUTA");
            return Envio.ok();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return Envio.fallo("SIN_CONFIRMACION");
        } catch (ExecutionException | TimeoutException sinConfirmacion) {
            return Envio.fallo("SIN_CONFIRMACION");
        } catch (AmqpException brokerCaido) {
            return Envio.fallo("BROKER_NO_DISPONIBLE");
        }
    }
}
