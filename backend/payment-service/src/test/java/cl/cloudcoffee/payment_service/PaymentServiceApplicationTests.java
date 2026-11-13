package cl.cloudcoffee.payment_service;

import cl.cloudcoffee.security.testing.ServiceJwtTests;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"management.health.rabbit.enabled=false", "management.tracing.export.zipkin.enabled=false"})
@AutoConfigureMockMvc
class PaymentServiceApplicationTests extends ServiceJwtTests {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    @Test
    void migrationsRunAtStartupWithoutCreatingPayments() {
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM payment_intent", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM payment_inbox", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM payment_outbox", Integer.class)).isZero();
    }

    @Test
    void webhookFailsClosedWithoutJwtAndDoesNotPersistUnverifiedInput() throws Exception {
        mvc.perform(post("/payments/webhooks/mercadopago?data.id=123&type=payment")
                        .header("x-signature", "unverified")
                        .header("x-request-id", "untrusted")
                        .contentType("application/json").content("{\"id\":\"123\",\"type\":\"payment\"}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(content().contentTypeCompatibleWith("application/problem+json"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Retry-After", "2"))
                .andExpect(jsonPath("$.code").value("PAYMENT_NOT_ENABLED"))
                .andExpect(jsonPath("$.timestamp").isString());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM payment_inbox", Integer.class)).isZero();
    }

    @Test
    void webhookExceptionIsRestrictedToExactPostAndDoesNotOpenOtherEndpoints() throws Exception {
        mvc.perform(get("/payments/webhooks/mercadopago")).andExpect(status().isUnauthorized());
        mvc.perform(post("/payments/webhooks/mercadopago/other")).andExpect(status().isUnauthorized());
        mvc.perform(post("/internal/servicios/payments/preferencias"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void disabledProviderFailsClosedWithoutPersistingIntents() throws Exception {
        mvc.perform(post("/internal/servicios/payments/preferencias")
                        .header("X-Internal-Service-Token", INTERNAL_TOKEN)
                        .header("Idempotency-Key", java.util.UUID.randomUUID().toString())
                        .contentType("application/json").content("{}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(content().contentTypeCompatibleWith("application/problem+json"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.code").value("PAYMENT_NOT_ENABLED"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM payment_intent", Integer.class)).isZero();
        mvc.perform(get("/internal/servicios/payments/preferencias/" + java.util.UUID.randomUUID())
                        .header("X-Internal-Service-Token", INTERNAL_TOKEN))
                .andExpect(status().isNotFound());
    }
}
