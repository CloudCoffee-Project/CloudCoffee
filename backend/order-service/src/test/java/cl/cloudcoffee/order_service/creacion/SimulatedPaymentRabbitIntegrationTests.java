package cl.cloudcoffee.order_service.creacion;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;

import cl.cloudcoffee.order_service.model.Compra;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import com.nimbusds.jose.JWSAlgorithm;
import tools.jackson.databind.json.JsonMapper;

/** INT2-103: pago simulado, PostgreSQL y publicación outbox contra RabbitMQ reales. */
@EnabledIfEnvironmentVariable(named = "RABBIT_INTEGRATION_TEST", matches = "true")
@SpringBootTest(properties = {
        "cloudcoffee.payment.provider=simulado",
        "cloudcoffee.creation.recovery-enabled=false",
        "cloudcoffee.creation.publish-enabled=false",
        "cloudcoffee.revision.recovery-enabled=false",
        "cloudcoffee.pagos.recovery-enabled=false",
        "cloudcoffee.pagos.consumer-enabled=false",
        "management.tracing.enabled=false"
})
@AutoConfigureMockMvc
class SimulatedPaymentRabbitIntegrationTests extends JwtTestSupport {

    @Autowired MockMvc mvc;
    @Autowired CompraRepository compras;
    @Autowired JdbcTemplate jdbc;
    @Autowired RabbitTemplate rabbit;
    @Autowired PlatformTransactionManager transactionManager;
    @Autowired JsonMapper json;

    @Test
    void approvedSimulationPersistsAndPublishesEachEventOnlyOnce() throws Exception {
        UUID customerId = UUID.randomUUID();
        Compra purchase = compras.saveAndFlush(new Compra(customerId, new BigDecimal("3700.00")));
        String queue = "int2103.order.simulated." + UUID.randomUUID();

        rabbit.execute(channel -> {
            channel.exchangeDeclare("cloudcoffee.events", "topic", true);
            channel.queueDeclare(queue, false, false, false, null);
            channel.queueBind(queue, "cloudcoffee.events", "order.#");
            return null;
        });

        try {
            jdbc.update("UPDATE order_outbox SET publicado=TRUE");

            mvc.perform(post("/compras/{id}/pago", purchase.getId())
                            .header("Authorization", bearer(customerId))
                            .header("Idempotency-Key", UUID.randomUUID())
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"escenario\":\"aprobar\"}"))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.estado").value("aprobado"))
                    .andExpect(jsonPath("$.motivo").value("aprobacion_simulada"))
                    .andExpect(jsonPath("$.proveedor").value("simulado"))
                    .andExpect(jsonPath("$.simulado").value(true));

            var pendingIds = jdbc.queryForList("""
                    SELECT event_id FROM order_outbox
                    WHERE publicado=FALSE AND cuerpo LIKE ?
                    ORDER BY created_at, event_id
                    """, UUID.class, "%" + purchase.getId() + "%");
            assertThat(pendingIds).hasSize(2);

            new OrderEventOutbox(jdbc, rabbit, transactionManager).publicar();

            assertThat(jdbc.queryForObject("""
                    SELECT COUNT(*) FROM order_outbox
                    WHERE event_id IN (?, ?) AND publicado=TRUE
                    """, Integer.class, pendingIds.get(0), pendingIds.get(1))).isEqualTo(2);

            Set<String> receivedIds = new HashSet<>();
            Set<String> receivedTypes = new HashSet<>();
            Message message;
            while ((message = rabbit.receive(queue, 250)) != null) {
                var event = json.readTree(message.getBody());
                receivedIds.add(event.path("eventId").asString());
                receivedTypes.add(event.path("eventType").asString());
                assertThat(event.path("traceId").asString()).hasSize(32);
                assertThat(event.path("payload").path("compraId").asString())
                        .isEqualTo(purchase.getId().toString());
            }

            assertThat(receivedIds).containsExactlyInAnyOrderElementsOf(
                    pendingIds.stream().map(UUID::toString).toList());
            assertThat(receivedTypes).containsExactlyInAnyOrder(
                    "order.pago.resultado.v1",
                    "order.compra.estado-cambiado.v1");

            new OrderEventOutbox(jdbc, rabbit, transactionManager).publicar();
            assertThat(rabbit.receive(queue, 150)).isNull();
        } finally {
            rabbit.execute(channel -> {
                channel.queueDelete(queue);
                return null;
            });
        }
    }

    private static String bearer(UUID customerId) {
        return "Bearer " + sign(
                claims().subject(customerId.toString()).claim("role", "CLIENTE").build(),
                KEYS,
                JWSAlgorithm.RS256);
    }
}
