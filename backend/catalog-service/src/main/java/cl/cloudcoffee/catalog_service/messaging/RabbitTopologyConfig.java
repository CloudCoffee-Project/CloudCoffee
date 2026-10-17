package cl.cloudcoffee.catalog_service.messaging;

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

    public static final String CATALOG_EVENTS_QUEUE = "catalog.events";
    public static final String CATALOG_DLQ = "catalog.events.dlq";
    public static final String CATALOG_DLQ_ROUTING_KEY = "catalog.events.dlq";

    public static final String PAGO_APROBADO_EVENT = "order.pago.aprobado.v1";

    @Bean
    TopicExchange eventsExchange() {
        return new TopicExchange(EVENTS_EXCHANGE, true, false);
    }

    @Bean
    DirectExchange deadLetterExchange() {
        return new DirectExchange(DEAD_LETTER_EXCHANGE, true, false);
    }

    @Bean
    Queue catalogEventsQueue() {
        return QueueBuilder.durable(CATALOG_EVENTS_QUEUE)
                .withArgument("x-dead-letter-exchange", DEAD_LETTER_EXCHANGE)
                .withArgument("x-dead-letter-routing-key", CATALOG_DLQ_ROUTING_KEY)
                .build();
    }

    @Bean
    Queue catalogDeadLetterQueue() {
        return QueueBuilder.durable(CATALOG_DLQ).build();
    }

    @Bean
    Binding catalogPagoAprobadoBinding(Queue catalogEventsQueue, TopicExchange eventsExchange) {
        return BindingBuilder.bind(catalogEventsQueue).to(eventsExchange).with(PAGO_APROBADO_EVENT);
    }

    @Bean
    Binding catalogDeadLetterBinding(Queue catalogDeadLetterQueue, DirectExchange deadLetterExchange) {
        return BindingBuilder.bind(catalogDeadLetterQueue).to(deadLetterExchange).with(CATALOG_DLQ_ROUTING_KEY);
    }

    @Bean
    JacksonJsonMessageConverter jsonMessageConverter() {
        return new JacksonJsonMessageConverter();
    }
}
