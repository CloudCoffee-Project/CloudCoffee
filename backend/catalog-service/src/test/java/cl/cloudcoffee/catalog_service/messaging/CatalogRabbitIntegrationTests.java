package cl.cloudcoffee.catalog_service.messaging;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.slf4j.MDC;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import cl.cloudcoffee.catalog_service.model.entity.Cafeteria;
import cl.cloudcoffee.catalog_service.model.entity.Campus;
import cl.cloudcoffee.catalog_service.model.entity.Offer;
import cl.cloudcoffee.catalog_service.model.entity.Product;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import tools.jackson.databind.json.JsonMapper;

@EnabledIfEnvironmentVariable(named = "RABBIT_INTEGRATION_TEST", matches = "true")
@SpringBootTest(properties = "management.tracing.enabled=false")
class CatalogRabbitIntegrationTests extends JwtTestSupport {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    @Autowired
    private StockEventPublisher publisher;

    @Autowired
    private JsonMapper jsonMapper;

    @AfterEach
    void clearTraceContext() {
        MDC.clear();
    }

    @Test
    void publishesStockUpdateThroughRealBroker() throws Exception {
        String queue = "int2103.catalog." + UUID.randomUUID();
        rabbitTemplate.execute(channel -> {
            channel.exchangeDeclare(RabbitTopologyConfig.EVENTS_EXCHANGE, "topic", true);
            channel.queueDeclare(queue, false, false, false, null);
            channel.queueBind(
                    queue,
                    RabbitTopologyConfig.EVENTS_EXCHANGE,
                    StockEventPublisher.STOCK_UPDATED_EVENT);
            return null;
        });

        try {
            UUID offerId = UUID.randomUUID();
            UUID productId = UUID.randomUUID();
            UUID cafeteriaId = UUID.randomUUID();
            UUID campusId = UUID.randomUUID();
            String traceId = "aabbccddeeff00112233445566778899";

            Campus campus = new Campus();
            campus.setId(campusId);
            Cafeteria cafeteria = new Cafeteria();
            cafeteria.setId(cafeteriaId);
            cafeteria.setCampus(campus);
            Product product = new Product();
            product.setId(productId);
            Offer offer = new Offer();
            offer.setId(offerId);
            offer.setProduct(product);
            offer.setCafeteria(cafeteria);
            offer.setStock(7);
            offer.setVersion(3L);

            MDC.put("traceId", traceId);
            publisher.publishStockUpdated(offer);

            Message message = rabbitTemplate.receive(queue, 2_000);
            assertThat(message).isNotNull();
            var event = jsonMapper.readTree(message.getBody());
            assertThat(event.path("eventId").asString()).isNotBlank();
            assertThat(event.path("timestamp").asString()).isNotBlank();
            assertThat(event.path("traceId").asString()).isEqualTo(traceId);
            assertThat(event.path("eventType").asString())
                    .isEqualTo(StockEventPublisher.STOCK_UPDATED_EVENT);
            assertThat(event.path("payload").path("ofertaId").asString())
                    .isEqualTo(offerId.toString());
            assertThat(event.path("payload").path("productoId").asString())
                    .isEqualTo(productId.toString());
            assertThat(event.path("payload").path("cafeteriaId").asString())
                    .isEqualTo(cafeteriaId.toString());
            assertThat(event.path("payload").path("campusId").asString())
                    .isEqualTo(campusId.toString());
            assertThat(event.path("payload").path("stockActual").asInt()).isEqualTo(7);
            assertThat(event.path("payload").path("version").asLong()).isEqualTo(3L);
        } finally {
            rabbitTemplate.execute(channel -> {
                channel.queueDelete(queue);
                return null;
            });
        }
    }
}
