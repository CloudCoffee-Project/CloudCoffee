package cl.cloudcoffee.auth_service.messaging;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.support.converter.JacksonJsonMessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RabbitTopologyConfig {

    public static final String EVENTS_EXCHANGE = "cloudcoffee.events";
    public static final String DEAD_LETTER_EXCHANGE = "cloudcoffee.dlx";

    public static final String AUTH_EVENTS_QUEUE = "auth.events";
    public static final String AUTH_DLQ = "auth.events.dlq";
    public static final String AUTH_DLQ_ROUTING_KEY = "auth.events.dlq";

    @Bean
    TopicExchange eventsExchange() {
        return new TopicExchange(EVENTS_EXCHANGE, true, false);
    }

    @Bean
    DirectExchange deadLetterExchange() {
        return new DirectExchange(DEAD_LETTER_EXCHANGE, true, false);
    }

    @Bean
    Queue authEventsQueue() {
        return QueueBuilder.durable(AUTH_EVENTS_QUEUE)
                .withArgument("x-dead-letter-exchange", DEAD_LETTER_EXCHANGE)
                .withArgument("x-dead-letter-routing-key", AUTH_DLQ_ROUTING_KEY)
                .build();
    }

    @Bean
    Queue authDeadLetterQueue() {
        return QueueBuilder.durable(AUTH_DLQ).build();
    }

    @Bean
    Binding authEventsBinding(
            Queue authEventsQueue,
            TopicExchange eventsExchange
    ) {
        return BindingBuilder.bind(authEventsQueue)
                .to(eventsExchange)
                .with("catalog.cafeteria.created.v1");
    }

    @Bean
    Binding authDeadLetterBinding(
            Queue authDeadLetterQueue,
            DirectExchange deadLetterExchange
    ) {
        return BindingBuilder.bind(authDeadLetterQueue)
                .to(deadLetterExchange)
                .with(AUTH_DLQ_ROUTING_KEY);
    }

    @Bean
    JacksonJsonMessageConverter jsonMessageConverter() {
        return new JacksonJsonMessageConverter();
    }
}