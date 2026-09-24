package cl.cloudcoffee.notification_service.messaging;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.amqp.core.AmqpAdmin;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;

@EnabledIfEnvironmentVariable(named = "RABBIT_INTEGRATION_TEST", matches = "true")
@SpringBootTest
class NotificationRabbitIntegrationTest {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    @Autowired
    private AmqpAdmin amqpAdmin;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void authEventIsConsumedAndRecordedInPostgreSql() throws InterruptedException {
        assertThat(amqpAdmin.getQueueProperties(RabbitTopologyConfig.NOTIFICATION_EVENTS_QUEUE))
                .isNotNull();

        String eventType = "auth.user.registered.v1";
        String tracePrefix = "ci-rabbit-" + UUID.randomUUID();
        String email = "ci-user@cloudcoffee.test";
        int eventCount = 8;
        for (int index = 0; index < eventCount; index++) {
            CloudCoffeeEvent event = new CloudCoffeeEvent(UUID.randomUUID(), Instant.now(),
                    tracePrefix + "-" + index, eventType,
                    Map.of("userId", "ci-user", "email", email));
            // Auth publishes its own record type, so the incoming type header names that class.
            rabbitTemplate.convertAndSend(RabbitTopologyConfig.EVENTS_EXCHANGE, eventType, event,
                    message -> {
                        message.getMessageProperties().setHeader("__TypeId__",
                                "cl.cloudcoffee.auth_service.messaging.CloudCoffeeEvent");
                        return message;
                    });
        }

        int recorded = 0;
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        while (System.nanoTime() < deadline) {
            recorded = jdbcTemplate.queryForObject("""
                    SELECT count(*) FROM notification_history
                    WHERE tracking_id LIKE ? AND event_type = ?
                      AND status = 'RECEIVED' AND payload ->> 'email' = ?
                    """, Integer.class, tracePrefix + "%", eventType, email);
            if (recorded == eventCount) {
                break;
            }
            Thread.sleep(100);
        }
        assertThat(recorded).isEqualTo(eventCount);
    }
}
