package cl.cloudcoffee.order_service.messaging;

import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.support.converter.JacksonJsonMessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** order-service solo publica: declara el exchange común y el formato JSON. */
@Configuration
public class RabbitTopologyConfig {

    public static final String EVENTS_EXCHANGE = "cloudcoffee.events";

    @Bean
    TopicExchange eventsExchange() {
        return new TopicExchange(EVENTS_EXCHANGE, true, false);
    }

    @Bean
    JacksonJsonMessageConverter jsonMessageConverter() {
        return new JacksonJsonMessageConverter();
    }
}
