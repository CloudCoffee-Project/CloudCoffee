package cl.cloudcoffee.payment_service.messaging;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.support.converter.JacksonJsonMessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Topología de Payment. Publica en el exchange compartido {@code cloudcoffee.events}; los eventos que agotan sus
 * reintentos van a {@code payment.events.dlq} por el exchange de dead letters compartido {@code cloudcoffee.dlx}.
 * El consumidor de Order (INT2-113) declara su propia cola.
 */
@Configuration(proxyBeanMethods = false)
public class PaymentMessagingConfiguration {
    public static final String EVENTS_EXCHANGE = "cloudcoffee.events";
    public static final String PAYMENT_RESULT = "payment.pago.resultado.v1";
    public static final String DEAD_LETTER_EXCHANGE = "cloudcoffee.dlx";
    public static final String PAYMENT_DLQ = "payment.events.dlq";

    @Bean
    TopicExchange paymentEventsExchange() {
        return new TopicExchange(EVENTS_EXCHANGE, true, false);
    }

    @Bean
    DirectExchange paymentDeadLetterExchange() {
        return new DirectExchange(DEAD_LETTER_EXCHANGE, true, false);
    }

    @Bean
    Queue paymentDeadLetterQueue() {
        return QueueBuilder.durable(PAYMENT_DLQ).build();
    }

    @Bean
    Binding paymentDeadLetterBinding(Queue paymentDeadLetterQueue, DirectExchange paymentDeadLetterExchange) {
        return BindingBuilder.bind(paymentDeadLetterQueue).to(paymentDeadLetterExchange).with(PAYMENT_DLQ);
    }

    @Bean
    JacksonJsonMessageConverter paymentMessageConverter() {
        return new JacksonJsonMessageConverter();
    }
}
