package cl.cloudcoffee.payment_service.messaging;

import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.support.converter.JacksonJsonMessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Shared durable exchange only; consumers/publisher and retry topology belong to INT2-112/113. */
@Configuration(proxyBeanMethods = false)
public class PaymentMessagingConfiguration {
    public static final String EVENTS_EXCHANGE = "cloudcoffee.events";
    public static final String PAYMENT_RESULT = "payment.pago.resultado.v1";

    @Bean
    TopicExchange paymentEventsExchange() {
        return new TopicExchange(EVENTS_EXCHANGE, true, false);
    }

    @Bean
    JacksonJsonMessageConverter paymentMessageConverter() {
        return new JacksonJsonMessageConverter();
    }
}
