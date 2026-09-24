package cl.cloudcoffee.auth_service.messaging;

import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.amqp.core.AmqpAdmin;
import org.springframework.amqp.core.AnonymousQueue;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.assertj.core.api.Assertions.assertThat;

@EnabledIfEnvironmentVariable(named = "RABBIT_INTEGRATION_TEST", matches = "true")
@SpringBootTest(properties = "spring.rabbitmq.listener.simple.auto-startup=false")
class AuthRabbitIntegrationTest {

    @Autowired
    private AuthEventPublisher publisher;

    @Autowired
    private RabbitTemplate rabbitTemplate;

    @Autowired
    private AmqpAdmin amqpAdmin;

    @Test
    void publishedEventReachesRabbitMqWithTheExpectedRoutingKeyAndPayload() {
        TopicExchange exchange = new TopicExchange(RabbitTopologyConfig.EVENTS_EXCHANGE, true, false);
        Queue queue = new AnonymousQueue();
        amqpAdmin.declareExchange(exchange);
        amqpAdmin.declareQueue(queue);
        amqpAdmin.declareBinding(BindingBuilder.bind(queue).to(exchange)
                .with(AuthEventPublisher.USER_REGISTERED_EVENT));

        try {
            CloudCoffeeEvent published = publisher.publishUserRegistered(
                    "ci-user", "ci-user@cloudcoffee.test", "ci-trace");

            Message message = rabbitTemplate.receive(queue.getName(), 5_000);
            assertThat(message).isNotNull();
            assertThat(message.getMessageProperties().getReceivedRoutingKey())
                    .isEqualTo(AuthEventPublisher.USER_REGISTERED_EVENT);
            Object typeHeader = message.getMessageProperties().getHeader("__TypeId__");
            assertThat(typeHeader).isEqualTo(CloudCoffeeEvent.class.getName());
            assertThat(new String(message.getBody(), StandardCharsets.UTF_8))
                    .contains("\"eventId\":\"" + published.eventId() + "\"",
                            "\"eventType\":\"" + AuthEventPublisher.USER_REGISTERED_EVENT + "\"",
                            "\"traceId\":\"ci-trace\"",
                            "\"email\":\"ci-user@cloudcoffee.test\"");
        } finally {
            amqpAdmin.deleteQueue(queue.getName());
        }
    }
}
