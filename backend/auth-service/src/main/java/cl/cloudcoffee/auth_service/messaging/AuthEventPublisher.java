package cl.cloudcoffee.auth_service.messaging;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;

@Component
public class AuthEventPublisher {

    public static final String USER_REGISTERED_EVENT =
            "auth.user.registered.v1";

    private final RabbitTemplate rabbitTemplate;

    public AuthEventPublisher(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    public CloudCoffeeEvent publishUserRegistered(
            String userId,
            String email,
            String traceId
    ) {
        CloudCoffeeEvent event = new CloudCoffeeEvent(
                UUID.randomUUID(),
                Instant.now(),
                traceId,
                USER_REGISTERED_EVENT,
                Map.of(
                        "userId", userId,
                        "email", email
                )
        );

        rabbitTemplate.convertAndSend(
                RabbitTopologyConfig.EVENTS_EXCHANGE,
                USER_REGISTERED_EVENT,
                event
        );

        return event;
    }
}
