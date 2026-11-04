package cl.cloudcoffee.catalog_service.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

import cl.cloudcoffee.catalog_service.model.entity.StockReservation;

class StockReservationMigrationTests {

    @Test
    void upgradePreservesLegacyHistoryAndEnforcesUniquenessPerAttempt() {
        String url = System.getenv().getOrDefault("RESERVATION_TEST_DB_URL",
                "jdbc:h2:mem:reservation-migration;DB_CLOSE_DELAY=-1;MODE=PostgreSQL");
        String user = System.getenv().getOrDefault("RESERVATION_TEST_DB_USER", "sa");
        String password = System.getenv().getOrDefault("RESERVATION_TEST_DB_PASSWORD", "");
        String schema = "migration_" + UUID.randomUUID().toString().replace("-", "");
        String quotedSchema = "\"" + schema + "\"";
        // Keep the migration session open: H2 check expressions may retain that session.
        var dataSource = new SingleConnectionDataSource(url, user, password, true);
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        try {
            Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema)
                    .target("3").load().migrate();
            UUID campus = UUID.randomUUID();
            UUID category = UUID.randomUUID();
            UUID cafeteria = UUID.randomUUID();
            UUID product = UUID.randomUUID();
            UUID offer = UUID.randomUUID();
            UUID order = UUID.randomUUID();
            UUID reservation = UUID.randomUUID();
            jdbc.update("INSERT INTO " + quotedSchema + ".campus (id, name) VALUES (?, 'Campus')", campus);
            jdbc.update("INSERT INTO " + quotedSchema + ".category (id, name) VALUES (?, 'Category')", category);
            jdbc.update("INSERT INTO " + quotedSchema + ".cafeteria (id, campus_id, name) VALUES (?, ?, 'Cafe')",
                    cafeteria, campus);
            jdbc.update("INSERT INTO " + quotedSchema + ".product (id, category_id, name) VALUES (?, ?, 'Product')",
                    product, category);
            jdbc.update("INSERT INTO " + quotedSchema
                    + ".offer (id, cafeteria_id, product_id, price, stock) VALUES (?, ?, ?, 1000, 2)",
                    offer, cafeteria, product);
            jdbc.update("INSERT INTO " + quotedSchema + ".stock_reservation "
                    + "(id, order_id, offer_id, quantity, status, reserved_at, expires_at) "
                    + "VALUES (?, ?, ?, 1, 'RELEASED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '5' MINUTE)",
                    reservation, order, offer);

            Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema)
                    .load().migrate();

            assertThat(jdbc.queryForObject("SELECT attempt_id FROM " + quotedSchema
                    + ".stock_reservation WHERE id = ?", UUID.class, reservation))
                    .isEqualTo(StockReservation.LEGACY_ATTEMPT_ID);
            assertThat(jdbc.queryForObject("SELECT status FROM " + quotedSchema
                    + ".stock_reservation WHERE id = ?", String.class, reservation)).isEqualTo("RELEASED");
            String insert = "INSERT INTO " + quotedSchema + ".stock_reservation "
                    + "(id, order_id, offer_id, attempt_id, quantity, status, reserved_at, expires_at) "
                    + "VALUES (?, ?, ?, ?, 1, 'RESERVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '5' MINUTE)";
            UUID nextAttempt = UUID.randomUUID();
            jdbc.update(insert, UUID.randomUUID(), order, offer, nextAttempt);
            assertThatThrownBy(() -> jdbc.update(insert, UUID.randomUUID(), order, offer, nextAttempt))
                    .isInstanceOf(DataIntegrityViolationException.class);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + quotedSchema + ".stock_reservation", Integer.class))
                    .isEqualTo(2);
        } finally {
            try {
                jdbc.execute("DROP SCHEMA IF EXISTS " + quotedSchema + " CASCADE");
            } finally {
                dataSource.destroy();
            }
        }
    }
}
