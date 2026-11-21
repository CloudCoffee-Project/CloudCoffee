package cl.cloudcoffee.notification_service.push;

import cl.cloudcoffee.security.testing.ServiceJwtTests;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.data.domain.PageRequest;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(properties = {
        "spring.rabbitmq.listener.simple.auto-startup=false",
        "management.health.rabbit.enabled=false",
        "management.health.mail.enabled=false"
})
@AutoConfigureMockMvc
class NotificationPushPersistenceTests extends ServiceJwtTests {

    @Autowired NotificationPushDeliveryRepository repository;

    @Test
    @Transactional
    void persistsPendingDeliveryAndClaimsItForTheWorker() {
        NotificationPushDelivery delivery = new NotificationPushDelivery(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                "Retiro listo", "Tu pedido está listo.", Map.of(
                        "url", "/(cliente)/mis-compras",
                        "eventType", "order.orden.estado-cambiado.v1"),
                Instant.now());
        repository.saveAndFlush(delivery);

        assertThat(repository.existsByEventIdAndChannelAndDeviceTokenId(
                delivery.getEventId(), "FCM", delivery.getDeviceTokenId())).isTrue();
        assertThat(repository.lockDueDeliveries(Instant.now(), PageRequest.of(0, 100)))
                .extracting(NotificationPushDelivery::getId)
                .containsExactly(delivery.getId());
    }
}
