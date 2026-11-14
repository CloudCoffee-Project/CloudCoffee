package cl.cloudcoffee.payment_service.messaging;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.rabbit.connection.CachingConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.amqp.rabbit.core.RabbitTemplate;

import static org.assertj.core.api.Assertions.assertThat;

/** Publisher confirms y mandatory contra un RabbitMQ real (job "RabbitMQ event flow" de CI). */
@EnabledIfEnvironmentVariable(named = "RABBIT_INTEGRATION_TEST", matches = "true")
class RabbitCanalEventosIntegrationTests {

    CachingConnectionFactory conexion;
    RabbitTemplate rabbit;
    RabbitAdmin admin;
    RabbitCanalEventos canal;
    // Exchange y cola propios: otros servicios del mismo job pueden enlazar '#' a cloudcoffee.events.
    String exchange = "int2112.events." + UUID.randomUUID();
    String cola = "int2112.resultados." + UUID.randomUUID();

    static CachingConnectionFactory conexion(int puerto) {
        var factory = new CachingConnectionFactory(System.getenv().getOrDefault("SPRING_RABBITMQ_HOST", "localhost"), puerto);
        factory.setUsername(System.getenv().getOrDefault("SPRING_RABBITMQ_USERNAME", "guest"));
        factory.setPassword(System.getenv().getOrDefault("SPRING_RABBITMQ_PASSWORD", "guest"));
        factory.setPublisherConfirmType(CachingConnectionFactory.ConfirmType.CORRELATED);
        factory.setPublisherReturns(true);
        return factory;
    }

    static RabbitTemplate plantilla(CachingConnectionFactory factory) {
        var template = new RabbitTemplate(factory);
        template.setMandatory(true);
        return template;
    }

    @BeforeEach
    void preparar() {
        conexion = conexion(Integer.parseInt(System.getenv().getOrDefault("SPRING_RABBITMQ_PORT", "5672")));
        rabbit = plantilla(conexion);
        admin = new RabbitAdmin(conexion);
        canal = new RabbitCanalEventos(rabbit);
        TopicExchange eventos = new TopicExchange(exchange, false, true);
        Queue resultados = new Queue(cola, false, false, true);
        admin.declareExchange(eventos);
        admin.declareQueue(resultados);
        admin.declareBinding(BindingBuilder.bind(resultados).to(eventos).with(PaymentMessagingConfiguration.PAYMENT_RESULT));
        // Misma topología de DLQ que declara PaymentMessagingConfiguration.
        DirectExchange dlx = new DirectExchange(PaymentMessagingConfiguration.DEAD_LETTER_EXCHANGE, true, false);
        Queue dlq = QueueBuilder.durable(PaymentMessagingConfiguration.PAYMENT_DLQ).build();
        admin.declareExchange(dlx);
        admin.declareQueue(dlq);
        Binding binding = BindingBuilder.bind(dlq).to(dlx).with(PaymentMessagingConfiguration.PAYMENT_DLQ);
        admin.declareBinding(binding);
    }

    @AfterEach
    void cerrar() {
        admin.deleteQueue(cola);
        admin.deleteExchange(exchange);
        conexion.destroy();
    }

    @Test
    void confirmedAndRoutedEventKeepsItsStableEventIdAsMessageId() {
        UUID eventId = UUID.randomUUID();
        String cuerpo = "{\"eventId\":\"" + eventId + "\"}";
        assertThat(canal.enviar(exchange, PaymentMessagingConfiguration.PAYMENT_RESULT, eventId, cuerpo, null))
                .isEqualTo(CanalEventos.Envio.ok());
        Message mensaje = rabbit.receive(cola, 2000);
        assertThat(mensaje).isNotNull();
        assertThat(mensaje.getMessageProperties().getMessageId()).isEqualTo(eventId.toString());
        assertThat(new String(mensaje.getBody(), StandardCharsets.UTF_8)).isEqualTo(cuerpo);
        // Un reintento reenvía el mismo eventId: el consumidor deduplica.
        assertThat(canal.enviar(exchange, PaymentMessagingConfiguration.PAYMENT_RESULT, eventId, cuerpo, null).confirmado()).isTrue();
        assertThat(rabbit.receive(cola, 2000).getMessageProperties().getMessageId()).isEqualTo(eventId.toString());
    }

    @Test
    void unroutableEventIsNotReportedAsDelivered() {
        assertThat(canal.enviar(exchange, "payment.sin.consumidor", UUID.randomUUID(), "{}", null))
                .isEqualTo(CanalEventos.Envio.fallo("SIN_RUTA"));
    }

    @Test
    void exhaustedEventReachesThePaymentDeadLetterQueueWithItsError() {
        UUID eventId = UUID.randomUUID();
        assertThat(canal.enviar(PaymentMessagingConfiguration.DEAD_LETTER_EXCHANGE, PaymentMessagingConfiguration.PAYMENT_DLQ,
                eventId, "{}", "SIN_RUTA").confirmado()).isTrue();
        Message encontrado = null;
        for (int i = 0; i < 50 && encontrado == null; i++) {
            Message mensaje = rabbit.receive(PaymentMessagingConfiguration.PAYMENT_DLQ, 500);
            if (mensaje == null) break;
            if (eventId.toString().equals(mensaje.getMessageProperties().getMessageId())) encontrado = mensaje;
        }
        assertThat(encontrado).isNotNull();
        assertThat((String) encontrado.getMessageProperties().getHeader("x-cloudcoffee-error")).isEqualTo("SIN_RUTA");
    }

    @Test
    void unreachableBrokerIsAFailureNotAnException() {
        var caida = conexion(1);
        try {
            var resultado = new RabbitCanalEventos(plantilla(caida)).enviar(exchange,
                    PaymentMessagingConfiguration.PAYMENT_RESULT, UUID.randomUUID(), "{}", null);
            assertThat(resultado).isEqualTo(CanalEventos.Envio.fallo("BROKER_NO_DISPONIBLE"));
        } finally {
            caida.destroy();
        }
    }
}
