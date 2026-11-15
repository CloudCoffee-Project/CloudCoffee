package cl.cloudcoffee.order_service.messaging;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * INT2-113: cola propia de Order para {@code payment.pago.resultado.v1}. Un mensaje que agota sus reintentos
 * (o es inválido) va a {@code order.payment-results.dlq} por el exchange de dead letters compartido; la
 * conciliación periódica con Payment cubre igual ese resultado.
 */
@Configuration(proxyBeanMethods = false)
public class PaymentResultadosTopology {
    public static final String EVENTS_EXCHANGE = "cloudcoffee.events";
    public static final String DEAD_LETTER_EXCHANGE = "cloudcoffee.dlx";
    public static final String PAYMENT_RESULT = "payment.pago.resultado.v1";
    public static final String COLA = "order.payment-results";
    public static final String DLQ = "order.payment-results.dlq";

    @Bean
    TopicExchange paymentResultadosEventsExchange() {
        return new TopicExchange(EVENTS_EXCHANGE, true, false);
    }

    @Bean
    DirectExchange paymentResultadosDeadLetterExchange() {
        return new DirectExchange(DEAD_LETTER_EXCHANGE, true, false);
    }

    @Bean
    Queue paymentResultadosQueue() {
        return QueueBuilder.durable(COLA)
                .withArgument("x-dead-letter-exchange", DEAD_LETTER_EXCHANGE)
                .withArgument("x-dead-letter-routing-key", DLQ)
                .build();
    }

    @Bean
    Queue paymentResultadosDeadLetterQueue() {
        return QueueBuilder.durable(DLQ).build();
    }

    @Bean
    Binding paymentResultadosBinding(Queue paymentResultadosQueue, TopicExchange paymentResultadosEventsExchange) {
        return BindingBuilder.bind(paymentResultadosQueue).to(paymentResultadosEventsExchange).with(PAYMENT_RESULT);
    }

    @Bean
    Binding paymentResultadosDeadLetterBinding(Queue paymentResultadosDeadLetterQueue,
            DirectExchange paymentResultadosDeadLetterExchange) {
        return BindingBuilder.bind(paymentResultadosDeadLetterQueue).to(paymentResultadosDeadLetterExchange).with(DLQ);
    }
}
