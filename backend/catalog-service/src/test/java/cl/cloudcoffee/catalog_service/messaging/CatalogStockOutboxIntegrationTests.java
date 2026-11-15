package cl.cloudcoffee.catalog_service.messaging;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.when;
import cl.cloudcoffee.catalog_service.dto.ReserveStockRequest;
import cl.cloudcoffee.catalog_service.service.StockReservationService;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.*;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

@org.springframework.test.annotation.DirtiesContext(classMode = org.springframework.test.annotation.DirtiesContext.ClassMode.AFTER_CLASS)
@SpringBootTest(properties = {"catalog.outbox.publish-enabled=false",
        "catalog.reservations.expiration-scan-ms=3600000", "management.tracing.enabled=false"})
class CatalogStockOutboxIntegrationTests extends JwtTestSupport {
    static final Instant NOW = Instant.parse("2026-11-14T12:00:00Z");
    @Autowired JdbcTemplate jdbc;
    @Autowired StockReservationService reservations;
    @Autowired PlatformTransactionManager manager;
    @Autowired JsonMapper json;
    @MockitoBean Clock clock;
    UUID campus, category, cafeteria, product, offer, order;

    @BeforeEach
    void seedOwnOffer() {
        campus = UUID.randomUUID(); category = UUID.randomUUID(); cafeteria = UUID.randomUUID();
        product = UUID.randomUUID(); offer = UUID.randomUUID(); order = UUID.randomUUID();
        when(clock.instant()).thenReturn(NOW);
        jdbc.update("INSERT INTO campus (id, name) VALUES (?, 'Outbox campus')", campus);
        jdbc.update("INSERT INTO category (id, name) VALUES (?, ?)", category, "Outbox category " + category);
        jdbc.update("INSERT INTO cafeteria (id, campus_id, name) VALUES (?, ?, 'Outbox cafeteria')", cafeteria, campus);
        jdbc.update("INSERT INTO product (id, category_id, name) VALUES (?, ?, 'Outbox product')", product, category);
        jdbc.update("INSERT INTO offer (id, cafeteria_id, product_id, price, stock) VALUES (?, ?, ?, 1800, 5)", offer, cafeteria, product);
        MDC.put("traceId", "0123456789abcdef0123456789abcdef");
    }

    @AfterEach
    void removeOwnData() {
        MDC.clear();
        jdbc.update("DELETE FROM catalog_outbox WHERE cuerpo LIKE ?", "%" + offer + "%");
        jdbc.update("DELETE FROM stock_reservation WHERE offer_id=?", offer);
        jdbc.update("DELETE FROM offer WHERE id=?", offer);
        jdbc.update("DELETE FROM product WHERE id=?", product);
        jdbc.update("DELETE FROM cafeteria WHERE id=?", cafeteria);
        jdbc.update("DELETE FROM category WHERE id=?", category);
        jdbc.update("DELETE FROM campus WHERE id=?", campus);
    }

    @Test
    void reservationAndReleasePersistVersionedStockEventsWithoutAWorkingBroker() throws Exception {
        var request = new ReserveStockRequest(order, offer, 2);
        var reservation = reservations.reserve(request).reservation();
        assertThat(stock()).isEqualTo(3);
        assertThat(events()).isEqualTo(1);
        var event = json.readTree(jdbc.queryForObject("SELECT cuerpo FROM catalog_outbox WHERE cuerpo LIKE ?", String.class, "%" + offer + "%"));
        assertThat(event.path("traceId").asString()).isEqualTo(MDC.get("traceId"));
        assertThat(event.path("payload").path("stockActual").asInt()).isEqualTo(3);
        assertThat(event.path("payload").path("version").asLong())
                .isEqualTo(jdbc.queryForObject("SELECT version FROM offer WHERE id=?", Long.class, offer));
        reservations.reserve(request);
        assertThat(events()).isEqualTo(1);
        reservations.release(reservation.getId());
        assertThat(stock()).isEqualTo(5);
        assertThat(events()).isEqualTo(2);
        reservations.release(reservation.getId());
        assertThat(events()).isEqualTo(2);
    }

    @Test
    void concurrentReplaysChangeStockAndAppendTheBusinessEventOnlyOnce() throws Exception {
        var request = new ReserveStockRequest(order, offer, 2);
        try (var workers = java.util.concurrent.Executors.newFixedThreadPool(4)) {
            var calls = java.util.stream.IntStream.range(0, 4)
                    .<java.util.concurrent.Callable<UUID>>mapToObj(i -> () -> reservations.reserve(request).reservation().getId())
                    .toList();
            var results = workers.invokeAll(calls);
            java.util.Set<UUID> reservationIds = new java.util.HashSet<>();
            for (var result : results) reservationIds.add(result.get());
            assertThat(reservationIds).hasSize(1);
        }
        assertThat(stock()).isEqualTo(3);
        assertThat(events()).isEqualTo(1);
    }

    @Test
    void businessRollbackAlsoRemovesTheEventAndReservation() {
        assertThatThrownBy(() -> new TransactionTemplate(manager).executeWithoutResult(status -> {
            reservations.reserve(new ReserveStockRequest(order, offer, 2));
            assertThat(events()).isEqualTo(1);
            throw new IllegalStateException("fail after stock update and event write");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(stock()).isEqualTo(5);
        assertThat(events()).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM stock_reservation WHERE offer_id=?", Integer.class, offer)).isZero();
    }

    @Test
    void databaseFailureSavingAnEventRollsBackTheStockChange() {
        // A real failing SQL constraint at the append boundary, scoped to this test's product.
        String constraint = "ck_test_outbox_" + UUID.randomUUID().toString().replace("-", "");
        jdbc.execute("ALTER TABLE catalog_outbox ADD CONSTRAINT " + constraint
                + " CHECK (cuerpo NOT LIKE '%" + offer + "%')");
        try {
            assertThatThrownBy(() -> reservations.reserve(new ReserveStockRequest(order, offer, 2)))
                    .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
            assertThat(stock()).isEqualTo(5);
            assertThat(events()).isZero();
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM stock_reservation WHERE offer_id=?", Integer.class, offer)).isZero();
        } finally { jdbc.execute("ALTER TABLE catalog_outbox DROP CONSTRAINT " + constraint); }
    }

    @Test
    void expirationPersistsOnlyOneRestorationAndOneAdditionalEvent() {
        reservations.reserve(new ReserveStockRequest(order, offer, 2));
        when(clock.instant()).thenReturn(NOW.plusSeconds(600));
        reservations.expireForOffer(offer);
        reservations.expireForOffer(offer);
        assertThat(stock()).isEqualTo(5);
        assertThat(events()).isEqualTo(2);
    }

    int stock() { return jdbc.queryForObject("SELECT stock FROM offer WHERE id=?", Integer.class, offer); }
    int events() { return jdbc.queryForObject("SELECT COUNT(*) FROM catalog_outbox WHERE cuerpo LIKE ?", Integer.class, "%" + offer + "%"); }
}
