package cl.cloudcoffee.notification_service.messaging;

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

    public static final String NOTIFICATION_EVENTS_QUEUE = "notification.events";
    public static final String NOTIFICATION_DLQ = "notification.events.dlq";
    public static final String NOTIFICATION_DLQ_ROUTING_KEY =
            "notification.events.dlq";

    @Bean
    TopicExchange eventsExchange() {
        return new TopicExchange(EVENTS_EXCHANGE, true, false);
    }

    @Bean
    DirectExchange deadLetterExchange() {
        return new DirectExchange(DEAD_LETTER_EXCHANGE, true, false);
    }

    @Bean
    Queue notificationEventsQueue() {
        return QueueBuilder.durable(NOTIFICATION_EVENTS_QUEUE)
                .withArgument(
                        "x-dead-letter-exchange",
                        DEAD_LETTER_EXCHANGE
                )
                .withArgument(
                        "x-dead-letter-routing-key",
                        NOTIFICATION_DLQ_ROUTING_KEY
                )
                .build();
    }

    @Bean
    Queue notificationDeadLetterQueue() {
        return QueueBuilder.durable(NOTIFICATION_DLQ).build();
    }

    @Bean
    Binding notificationEventsBinding(
            Queue notificationEventsQueue,
            TopicExchange eventsExchange
    ) {
        return BindingBuilder.bind(notificationEventsQueue)
                .to(eventsExchange)
                .with("auth.#");
    }

    @Bean
    Binding notificationDeadLetterBinding(
            Queue notificationDeadLetterQueue,
            DirectExchange deadLetterExchange
    ) {
        return BindingBuilder.bind(notificationDeadLetterQueue)
                .to(deadLetterExchange)
                .with(NOTIFICATION_DLQ_ROUTING_KEY);
    }

    @Bean
    JacksonJsonMessageConverter jsonMessageConverter() {
        return new JacksonJsonMessageConverter();
    }
}