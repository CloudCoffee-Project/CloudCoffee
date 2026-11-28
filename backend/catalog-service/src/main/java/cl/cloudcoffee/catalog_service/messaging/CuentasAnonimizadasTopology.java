package cl.cloudcoffee.catalog_service.messaging;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * INT2-129: cola propia de Catalog para {@code auth.usuario.anonimizado.v1}. Un mensaje inválido o que agota
 * sus reintentos va a {@code catalog.cuentas-anonimizadas.dlq} por el exchange de dead letters compartido.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "catalog.cuentas.consumer-enabled", havingValue = "true", matchIfMissing = true)
public class CuentasAnonimizadasTopology {

    public static final String DEAD_LETTER_EXCHANGE = "cloudcoffee.dlx";
    public static final String USUARIO_ANONIMIZADO = "auth.usuario.anonimizado.v1";
    public static final String COLA = "catalog.cuentas-anonimizadas";
    public static final String DLQ = "catalog.cuentas-anonimizadas.dlq";

    @Bean
    DirectExchange cuentasAnonimizadasDeadLetterExchange() {
        return new DirectExchange(DEAD_LETTER_EXCHANGE, true, false);
    }

    @Bean
    Queue cuentasAnonimizadasQueue() {
        return QueueBuilder.durable(COLA)
                .withArgument("x-dead-letter-exchange", DEAD_LETTER_EXCHANGE)
                .withArgument("x-dead-letter-routing-key", DLQ)
                .build();
    }

    @Bean
    Queue cuentasAnonimizadasDeadLetterQueue() {
        return QueueBuilder.durable(DLQ).build();
    }

    @Bean
    Binding cuentasAnonimizadasBinding(Queue cuentasAnonimizadasQueue, TopicExchange eventsExchange) {
        return BindingBuilder.bind(cuentasAnonimizadasQueue).to(eventsExchange).with(USUARIO_ANONIMIZADO);
    }

    @Bean
    Binding cuentasAnonimizadasDeadLetterBinding(Queue cuentasAnonimizadasDeadLetterQueue,
            DirectExchange cuentasAnonimizadasDeadLetterExchange) {
        return BindingBuilder.bind(cuentasAnonimizadasDeadLetterQueue)
                .to(cuentasAnonimizadasDeadLetterExchange).with(DLQ);
    }
}
