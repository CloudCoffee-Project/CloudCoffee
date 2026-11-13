package cl.cloudcoffee.payment_service;

import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import static org.assertj.core.api.Assertions.*;

class PaymentStorageMigrationTests {
    SingleConnectionDataSource dataSource;
    JdbcTemplate jdbc;
    Flyway flyway;
    String schema;

    @BeforeEach
    void migrateIsolatedSchema() {
        dataSource = new SingleConnectionDataSource(
                System.getenv().getOrDefault("SPRING_DATASOURCE_URL", "jdbc:h2:mem:payment-migration;MODE=PostgreSQL;DB_CLOSE_DELAY=-1"),
                System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME", "sa"),
                System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD", ""), true);
        schema = "payment_test_" + UUID.randomUUID().toString().replace("-", "");
        flyway = Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).load();
        flyway.migrate();
        jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("SET SCHEMA '" + schema + "'");
    }

    @AfterEach
    void dropOnlyThisTestsSchema() {
        if (dataSource != null) {
            try { new JdbcTemplate(dataSource).execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE"); }
            finally { dataSource.destroy(); }
        }
    }

    @Test
    void oneIntentPerPurchaseAndOneUsePerIdempotencyKey() {
        UUID purchase = UUID.randomUUID(), key = UUID.randomUUID();
        intent(UUID.randomUUID(), purchase, key);
        assertThatThrownBy(() -> intent(UUID.randomUUID(), purchase, UUID.randomUUID()))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> intent(UUID.randomUUID(), UUID.randomUUID(), key))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void sandboxCurrencyAmountAndExpirationCannotBeOverridden() {
        UUID id = newIntent();
        for (String assignment : new String[]{"amount = 0", "amount = 2000000001", "currency = 'USD'",
                "environment = 'production'", "expires_at = created_at", "version = -1"}) {
            assertThatThrownBy(() -> jdbc.update("UPDATE payment_intent SET " + assignment + " WHERE id = ?", id))
                    .isInstanceOf(DataIntegrityViolationException.class);
        }
    }

    @Test
    void preferenceHasARealLocalForeignKeyAndCannotBeReplacedByAnotherPreference() {
        UUID id = newIntent();
        String sql = "INSERT INTO payment_preference (id, payment_intent_id, provider_preference_id, init_point) VALUES (?, ?, ?, ?)";
        jdbc.update(sql, UUID.randomUUID(), id, "preference-1", "https://sandbox.example/checkout");
        assertThatThrownBy(() -> jdbc.update(sql, UUID.randomUUID(), id, "preference-2", "https://sandbox.example/checkout"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(sql, UUID.randomUUID(), UUID.randomUUID(), "orphan", "https://sandbox.example/checkout"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("DELETE FROM payment_intent WHERE id = ?", id))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void multipleProviderPaymentsAreAuditedWithoutDuplicatingAProviderPaymentId() {
        UUID id = newIntent();
        String sql = "INSERT INTO provider_payment (id, payment_intent_id, provider_payment_id, provider_status, amount, currency, live_mode, provider_updated_at) "
                + "VALUES (?, ?, ?, 'approved', 4800, 'CLP', false, CURRENT_TIMESTAMP)";
        jdbc.update(sql, UUID.randomUUID(), id, "provider-1");
        jdbc.update(sql, UUID.randomUUID(), id, "provider-2");
        assertThatThrownBy(() -> jdbc.update(sql, UUID.randomUUID(), id, "provider-1"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM provider_payment", Integer.class)).isEqualTo(2);
    }

    @Test
    void inboxDeduplicatesNotificationsAndAllowsNewUpdatesOfTheSamePayment() {
        inbox("notification-1");
        assertThatThrownBy(() -> inbox("notification-1")).isInstanceOf(DataIntegrityViolationException.class);
        inbox("notification-2");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM payment_inbox", Integer.class)).isEqualTo(2);
        flyway.validate();
        assertThat(flyway.migrate().migrationsExecuted).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM payment_inbox", Integer.class)).isEqualTo(2);
    }

    @Test
    void outboxKeepsOneEventPerVersionAndRetainsPendingEventsAcrossRestart() {
        UUID id = newIntent();
        outbox(id, 1);
        assertThatThrownBy(() -> outbox(id, 1)).isInstanceOf(DataIntegrityViolationException.class);
        outbox(id, 2);
        assertThatThrownBy(() -> jdbc.update("UPDATE payment_outbox SET status = 'PUBLISHED'"))
                .isInstanceOf(DataIntegrityViolationException.class);
        flyway.validate();
        assertThat(flyway.migrate().migrationsExecuted).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM payment_outbox WHERE status = 'PENDING'", Integer.class)).isEqualTo(2);
    }

    UUID newIntent() {
        UUID id = UUID.randomUUID();
        intent(id, UUID.randomUUID(), UUID.randomUUID());
        return id;
    }

    void intent(UUID id, UUID purchase, UUID key) {
        jdbc.update("INSERT INTO payment_intent (id, compra_id, cliente_id, idempotency_key, request_hash, request_payload, "
                        + "amount, currency, provider, environment, external_reference, return_channel, expires_at) "
                        + "VALUES (?, ?, ?, ?, ?, '{}', 4800, 'CLP', 'mercadopago_sandbox', 'sandbox', ?, 'web', CURRENT_TIMESTAMP + INTERVAL '15' MINUTE)",
                id, purchase, UUID.randomUUID(), key, "a".repeat(64), id.toString());
    }

    void inbox(String notification) {
        jdbc.update("INSERT INTO payment_inbox (id, provider, notification_id, provider_payment_id, payload, trace_id) "
                        + "VALUES (?, 'mercadopago_sandbox', ?, 'provider-1', '{}', ?)",
                UUID.randomUUID(), notification, "a".repeat(32));
    }

    void outbox(UUID id, int version) {
        jdbc.update("INSERT INTO payment_outbox (event_id, payment_intent_id, aggregate_version, event_type, payload, trace_id, occurred_at) "
                        + "VALUES (?, ?, ?, 'payment.pago.resultado.v1', '{}', ?, CURRENT_TIMESTAMP)",
                UUID.randomUUID(), id, version, "a".repeat(32));
    }
}
