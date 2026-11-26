package cl.cloudcoffee.catalog_service.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Clock;
import java.time.Instant;
import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import com.nimbusds.jose.JWSAlgorithm;

import cl.cloudcoffee.catalog_service.dto.AdjustStockRequest;
import cl.cloudcoffee.catalog_service.dto.ReserveStockRequest;
import cl.cloudcoffee.catalog_service.messaging.StockEventPublisher;
import cl.cloudcoffee.catalog_service.model.enums.StockAdjustmentReason;
import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.security.AsignacionNoVerificableException;
import cl.cloudcoffee.security.AsignacionesCafeteria;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:stock-adjustments;DB_CLOSE_DELAY=-1;MODE=PostgreSQL;LOCK_TIMEOUT=10000",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "management.tracing.enabled=false",
        "catalog.reservations.expiration-scan-ms=3600000"
})
@AutoConfigureMockMvc
class StockAdjustmentIntegrationTests extends JwtTestSupport {
    private static final String PATH = "/catalog/cafeterias/{cafeteriaId}/ofertas/{ofertaId}/ajustes-stock";
    private static final Instant NOW = Instant.parse("2026-11-14T12:00:00Z");
    private static final String RESTOCK = """
            {"cantidad":12,"motivo":"REPOSICION","nota":" Reposición del día "}
            """;

    @Autowired StockAdjustmentService adjustments;
    @Autowired StockReservationService reservations;
    @Autowired JdbcTemplate jdbc;
    @Autowired JsonMapper json;
    @Autowired MockMvc mvc;
    @Autowired PlatformTransactionManager manager;
    @MockitoBean AsignacionesCafeteria assignments;
    @MockitoBean Clock clock;

    private UUID actor;
    private UUID campus;
    private UUID cafeteria;
    private UUID offer;
    private UUID product;

    @BeforeEach
    void seedOffer() {
        actor = UUID.randomUUID();
        campus = UUID.randomUUID();
        cafeteria = UUID.randomUUID();
        offer = UUID.randomUUID();
        product = UUID.randomUUID();
        UUID category = UUID.randomUUID();

        when(clock.instant()).thenReturn(NOW);
        when(assignments.cafeteriaDe(any())).thenReturn(Optional.empty());
        when(assignments.cafeteriaDe(actor)).thenReturn(Optional.of(cafeteria));
        jdbc.update("INSERT INTO campus (id, name) VALUES (?, 'Campus ajuste')", campus);
        jdbc.update("INSERT INTO category (id, name) VALUES (?, ?)", category, "Categoría " + category);
        jdbc.update("INSERT INTO cafeteria (id, campus_id, name) VALUES (?, ?, 'Cafetería ajuste')", cafeteria, campus);
        jdbc.update("INSERT INTO product (id, category_id, name) VALUES (?, ?, 'Producto ajuste')", product, category);
        jdbc.update("INSERT INTO offer (id, cafeteria_id, product_id, price, stock) VALUES (?, ?, ?, 1800, 10)",
                offer, cafeteria, product);
    }

    @ParameterizedTest
    @ValueSource(strings = {"CAJERO", "ADMIN_CAFETERIA"})
    void assignedStaffRecordsAuditAndDurableVersionedEvent(String role) throws Exception {
        var response = request(cafeteria, offer, token(actor, role, UUID.randomUUID()), UUID.randomUUID().toString(), RESTOCK)
                .andExpect(status().isCreated())
                .andExpect(header().exists("Location"))
                .andExpect(header().doesNotExist("Idempotency-Replayed"))
                .andExpect(jsonPath("$.ofertaId").value(offer.toString()))
                .andExpect(jsonPath("$.cantidad").value(12))
                .andExpect(jsonPath("$.motivo").value("REPOSICION"))
                .andExpect(jsonPath("$.nota").value("Reposición del día"))
                .andExpect(jsonPath("$.stockAnterior").value(10))
                .andExpect(jsonPath("$.stockActual").value(22))
                .andExpect(jsonPath("$.realizadoPor").value(actor.toString()))
                .andReturn().getResponse();
        var body = json.readTree(response.getContentAsString());
        assertThat(response.getHeader("Location")).endsWith("/ajustes-stock/" + body.path("ajusteId").asString());
        assertThat(jdbc.queryForObject("SELECT adjusted_by FROM stock_adjustment WHERE offer_id=?", UUID.class, offer))
                .isEqualTo(actor);
        assertThat(stock()).isEqualTo(22);

        var event = json.readTree(jdbc.queryForObject("""
                SELECT cuerpo FROM catalog_outbox WHERE event_type=? AND cuerpo LIKE ?
                """, String.class, StockEventPublisher.STOCK_UPDATED_EVENT, "%" + offer + "%"));
        assertThat(event.path("eventType").asString()).isEqualTo(StockEventPublisher.STOCK_UPDATED_EVENT);
        assertThat(event.path("eventId").asString()).isNotBlank();
        assertThat(event.path("traceId").asString()).isNotBlank();
        var payload = event.path("payload");
        assertThat(payload.path("cafeteriaId").asString()).isEqualTo(cafeteria.toString());
        assertThat(payload.path("campusId").asString()).isEqualTo(campus.toString());
        assertThat(payload.path("productoId").asString()).isEqualTo(product.toString());
        assertThat(payload.path("stockActual").asInt()).isEqualTo(22);
        assertThat(payload.path("version").asLong()).isEqualTo(
                jdbc.queryForObject("SELECT version FROM offer WHERE id=?", Long.class, offer));
    }

    @ParameterizedTest
    @ValueSource(strings = {"CLIENTE", "SUPER_ADMIN"})
    void nonStaffCannotAdjustEvenWithAnAssignment(String role) throws Exception {
        request(cafeteria, offer, token(actor, role, null), UUID.randomUUID().toString(), RESTOCK)
                .andExpect(status().isForbidden());
        assertUnchanged();
    }

    @Test
    void foreignOrUnassignedCafeteriaCannotBeAuthorizedByTokenClaim() throws Exception {
        UUID foreign = UUID.randomUUID();
        request(foreign, offer, token(actor, "CAJERO", foreign), UUID.randomUUID().toString(), RESTOCK)
                .andExpect(status().isForbidden());
        request(cafeteria, offer, token(UUID.randomUUID(), "ADMIN_CAFETERIA", cafeteria),
                UUID.randomUUID().toString(), RESTOCK).andExpect(status().isForbidden());
        jdbc.update("INSERT INTO cafeteria (id, campus_id, name) VALUES (?, ?, 'Otra cafetería')", foreign, campus);
        jdbc.update("UPDATE offer SET cafeteria_id=? WHERE id=?", foreign, offer);
        request(cafeteria, offer, token(actor, "ADMIN_CAFETERIA", null), UUID.randomUUID().toString(), RESTOCK)
                .andExpect(status().isNotFound());
        assertUnchanged();
    }

    @Test
    void anonymousAndUnverifiableAssignmentsAreRejected() throws Exception {
        when(assignments.cafeteriaDe(actor)).thenThrow(new AsignacionNoVerificableException("Auth no disponible", null));
        request(cafeteria, offer, token(actor, "CAJERO", cafeteria), UUID.randomUUID().toString(), RESTOCK)
                .andExpect(status().isForbidden());
        mvc.perform(post(PATH, cafeteria, offer).header("Idempotency-Key", UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON).content(RESTOCK))
                .andExpect(status().isUnauthorized());
        assertUnchanged();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"cantidad\":0,\"motivo\":\"MERMA\"}",
            "{\"cantidad\":-10001,\"motivo\":\"MERMA\"}", "{\"cantidad\":10001,\"motivo\":\"REPOSICION\"}",
            "{\"cantidad\":1.5,\"motivo\":\"REPOSICION\"}", "{\"cantidad\":\"2\",\"motivo\":\"REPOSICION\"}",
            "{\"cantidad\":2,\"motivo\":\"OTRO\"}", "{\"cantidad\":2,\"motivo\":\"REPOSICION\",\"nota\":\" \"}"})
    void invalidBodyDoesNotRecordOrPublish(String body) throws Exception {
        request(cafeteria, offer, token(actor, "CAJERO", null), UUID.randomUUID().toString(), body)
                .andExpect(status().isBadRequest());
        assertUnchanged();
    }

    @Test
    void validatesUuidAndAcceptsOnlyJson() throws Exception {
        String token = token(actor, "CAJERO", cafeteria);
        request(cafeteria, offer, token, "1-2-3-4-5", RESTOCK)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_INVALIDA"));
        mvc.perform(post(PATH, cafeteria, offer).header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", UUID.randomUUID()).contentType(MediaType.TEXT_PLAIN).content(RESTOCK))
                .andExpect(status().isUnsupportedMediaType());
        assertUnchanged();
    }

    @Test
    void replaysOriginalAdjustmentAndRejectsTheSameKeyWithADifferentBody() throws Exception {
        String key = UUID.randomUUID().toString();
        String token = token(actor, "CAJERO", cafeteria);
        var first = request(cafeteria, offer, token, key, RESTOCK)
                .andExpect(status().isCreated()).andReturn().getResponse();
        adjust(-5);
        var replay = request(cafeteria, offer, token, key, RESTOCK)
                .andExpect(status().isCreated())
                .andExpect(header().string("Idempotency-Replayed", "true"))
                .andReturn().getResponse();
        assertThat(replay.getContentAsString()).isEqualTo(first.getContentAsString());
        assertThat(replay.getHeader("Location")).isEqualTo(first.getHeader("Location"));
        request(cafeteria, offer, token, key, "{\"cantidad\":11,\"motivo\":\"REPOSICION\"}")
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("IDEMPOTENCY_CONFLICT"));
        assertThat(stock()).isEqualTo(17);
        assertThat(audits()).isEqualTo(2);
        assertThat(events()).isEqualTo(2);
    }

    @Test
    void deltaOnlyConsumesAvailableStockAndReleaseRestoresTheReservedUnits() {
        var reserved = reservations.reserve(reserve(4)).reservation();

        assertThatThrownBy(() -> adjust(-7)).isInstanceOfSatisfying(BusinessException.class,
                error -> assertThat(error.getCode()).isEqualTo("STOCK_NEGATIVO"));
        assertThat(stock()).isEqualTo(6);
        assertThat(audits()).isZero();
        assertThat(events()).isEqualTo(1);

        assertThat(adjust(-6).adjustment().stockActual()).isZero();
        assertThat(jdbc.queryForObject("SELECT status FROM offer WHERE id=?", String.class, offer))
                .isEqualTo("OUT_OF_STOCK");
        reservations.release(reserved.getId());
        assertThat(stock()).isEqualTo(4);
        assertThat(jdbc.queryForObject("SELECT status FROM offer WHERE id=?", String.class, offer))
                .isEqualTo("AVAILABLE");
    }

    @Test
    void directedRestockTargetsOnlyActiveFollowersOfThisCafeteriaAndGeneralFollowers() {
        UUID otherCafeteria = UUID.randomUUID();
        UUID otherOffer = UUID.randomUUID();
        UUID specificFollower = UUID.randomUUID();
        UUID generalFollower = UUID.randomUUID();
        UUID otherCafeFollower = UUID.randomUUID();
        UUID deletedFollower = UUID.randomUUID();
        UUID neverFollowed = UUID.randomUUID();
        jdbc.update("INSERT INTO cafeteria (id, campus_id, name) VALUES (?, ?, 'Otra cafetería')",
                otherCafeteria, campus);
        jdbc.update("INSERT INTO offer (id, cafeteria_id, product_id, price, stock) VALUES (?, ?, ?, 1800, 0)",
                otherOffer, otherCafeteria, product);
        jdbc.update("UPDATE offer SET stock=0, status='OUT_OF_STOCK' WHERE id=?", offer);
        addFollow(specificFollower, cafeteria, null);
        addFollow(generalFollower, null, null);
        addFollow(generalFollower, cafeteria, null);
        addFollow(otherCafeFollower, otherCafeteria, null);
        addFollow(deletedFollower, cafeteria, Timestamp.from(NOW));

        adjust(12);

        var event = directedEvent();
        var payload = event.path("payload");
        List<String> recipients = java.util.stream.StreamSupport
                .stream(payload.path("destinatarios").spliterator(), false)
                .map(node -> node.asString())
                .toList();
        assertThat(recipients).containsExactlyInAnyOrder(specificFollower.toString(), generalFollower.toString())
                .doesNotContain(otherCafeFollower.toString(), deletedFollower.toString(), neverFollowed.toString());
        assertThat(event.path("eventId").asString()).isNotBlank();
        assertThat(event.path("traceId").asString()).isNotBlank();
        assertThat(event.path("eventType").asString()).isEqualTo("catalog.producto.disponible.v1");
        assertThat(payload.path("productoNombre").asString()).isEqualTo("Producto ajuste");
        assertThat(payload.path("cafeteriaNombre").asString()).isEqualTo("Cafetería ajuste");
        assertThat(payload.path("campusNombre").asString()).isEqualTo("Campus ajuste");
        assertThat(availabilityEvents()).isEqualTo(1);
    }

    @Test
    void doesNotPublishDirectedRestockWithoutFollowersOrWhenStockRemainsPositive() {
        adjust(1);
        assertThat(availabilityEvents()).isZero();

        jdbc.update("UPDATE offer SET stock=0, status='OUT_OF_STOCK' WHERE id=?", offer);
        adjust(1);
        assertThat(availabilityEvents()).isZero();
    }

    @Test
    void releasingReservationThatRestoresZeroStockPublishesOneDirectedRestock() {
        UUID follower = UUID.randomUUID();
        addFollow(follower, cafeteria, null);
        var reservation = reservations.reserve(reserve(10)).reservation();
        assertThat(stock()).isZero();

        reservations.release(reservation.getId());

        assertThat(stock()).isEqualTo(10);
        assertThat(availabilityEvents()).isEqualTo(1);
        assertThat(directedEvent().path("payload").path("destinatarios").toString())
                .contains(follower.toString());
    }

    @Test
    void expirationConsumedBySameAdjustmentDoesNotPublishTransientAvailability() {
        addFollow(UUID.randomUUID(), cafeteria, null);
        reservations.reserve(reserve(4));
        adjust(-6);
        assertThat(stock()).isZero();
        when(clock.instant()).thenReturn(NOW.plusSeconds(3600));

        adjust(-4);

        assertThat(stock()).isZero();
        assertThat(availabilityEvents()).isZero();
    }

    @Test
    void concurrentAdjustmentsFromZeroPublishOnlyTheEffectiveTransition() throws Exception {
        UUID follower = UUID.randomUUID();
        addFollow(follower, cafeteria, null);
        jdbc.update("UPDATE offer SET stock=0, status='OUT_OF_STOCK' WHERE id=?", offer);
        try (var workers = Executors.newFixedThreadPool(2)) {
            var first = workers.submit(() -> adjust(1));
            var second = workers.submit(() -> adjust(1));
            first.get(10, TimeUnit.SECONDS);
            second.get(10, TimeUnit.SECONDS);
        }

        assertThat(stock()).isEqualTo(2);
        assertThat(availabilityEvents()).isEqualTo(1);
    }

    @Test
    void replayedAdjustmentDoesNotDuplicateTheDirectedRestock() {
        UUID follower = UUID.randomUUID();
        addFollow(follower, cafeteria, null);
        jdbc.update("UPDATE offer SET stock=0, status='OUT_OF_STOCK' WHERE id=?", offer);
        UUID key = UUID.randomUUID();
        var request = new AdjustStockRequest(1, StockAdjustmentReason.REPOSICION, null);

        adjustments.adjust(cafeteria, offer, actor, key, request);
        adjustments.adjust(cafeteria, offer, actor, key, request);

        assertThat(stock()).isEqualTo(1);
        assertThat(availabilityEvents()).isEqualTo(1);
    }

    @Test
    void rejectsRestockIfALaterReleaseWouldOverflowAvailableStock() {
        jdbc.update("UPDATE offer SET stock=? WHERE id=?", Integer.MAX_VALUE, offer);
        var reserved = reservations.reserve(reserve(4)).reservation();
        assertThatThrownBy(() -> adjust(1)).isInstanceOfSatisfying(BusinessException.class,
                error -> assertThat(error.getCode()).isEqualTo("STOCK_FUERA_DE_RANGO"));
        assertThat(audits()).isZero();
        reservations.release(reserved.getId());
        assertThat(stock()).isEqualTo(Integer.MAX_VALUE);
    }

    @Test
    void dueReservationsAreRestoredBeforeAdjusting() {
        var reserved = reservations.reserve(reserve(4)).reservation();
        when(clock.instant()).thenReturn(NOW.plusSeconds(3600));
        var result = adjust(-8).adjustment();
        assertThat(result.stockAnterior()).isEqualTo(10);
        assertThat(result.stockActual()).isEqualTo(2);
        reservations.release(reserved.getId());
        assertThat(stock()).isEqualTo(2);
        assertThat(events()).isEqualTo(3);
    }

    @Test
    void outboxWriteFailureAlsoRollsBackTheAuditAndStock() {
        String constraint = "ck_test_adjustment_outbox";
        jdbc.execute("ALTER TABLE catalog_outbox ADD CONSTRAINT " + constraint
                + " CHECK (cuerpo NOT LIKE '%" + offer + "%')");
        try {
            assertThatThrownBy(() -> adjust(12)).isInstanceOf(DataIntegrityViolationException.class);
            assertUnchanged();
        } finally {
            jdbc.execute("ALTER TABLE catalog_outbox DROP CONSTRAINT " + constraint);
        }
    }

    @Test
    void concurrentAdjustmentWaitsForReservationAndCannotConsumeItsUnits() throws Exception {
        var locked = new CountDownLatch(1);
        var unlock = new CountDownLatch(1);
        var adjustmentStarted = new CountDownLatch(1);
        try (var workers = Executors.newFixedThreadPool(2)) {
            var reservation = workers.submit(() -> new TransactionTemplate(manager).executeWithoutResult(status -> {
                reservations.reserve(reserve(4));
                locked.countDown();
                await(unlock);
            }));
            try {
                await(locked);
                var adjustment = workers.submit(() -> {
                    adjustmentStarted.countDown();
                    return adjust(-6);
                });
                await(adjustmentStarted);
                assertThatThrownBy(() -> adjustment.get(200, TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
                unlock.countDown();
                reservation.get(10, TimeUnit.SECONDS);
                var recorded = adjustment.get(10, TimeUnit.SECONDS).adjustment();
                assertThat(recorded.stockAnterior()).isEqualTo(6);
                assertThat(recorded.stockActual()).isZero();
            } finally {
                unlock.countDown();
            }
        }
        assertThat(stock()).isZero();
        assertThat(audits()).isEqualTo(1);
        assertThat(events()).isEqualTo(2);
    }

    @Test
    void concurrentReplaysRecordOnlyOneAdjustmentAndEvent() throws Exception {
        UUID key = UUID.randomUUID();
        Callable<StockAdjustmentService.Result> adjust = () -> adjustments.adjust(cafeteria, offer, actor, key,
                new AdjustStockRequest(12, StockAdjustmentReason.REPOSICION, null));
        try (var workers = Executors.newFixedThreadPool(2)) {
            var first = workers.submit(adjust);
            var second = workers.submit(adjust);
            var original = first.get(10, TimeUnit.SECONDS);
            var duplicate = second.get(10, TimeUnit.SECONDS);
            assertThat(original.adjustment()).isEqualTo(duplicate.adjustment());
            assertThat(original.replayed()).isNotEqualTo(duplicate.replayed());
        }
        assertThat(stock()).isEqualTo(22);
        assertThat(audits()).isEqualTo(1);
        assertThat(events()).isEqualTo(1);
    }

    private static void await(CountDownLatch latch) {
        try {
            assertThat(latch.await(10, TimeUnit.SECONDS)).isTrue();
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(exception);
        }
    }

    private ReserveStockRequest reserve(int quantity) {
        return new ReserveStockRequest(UUID.randomUUID(), offer, quantity, UUID.randomUUID(), null, null);
    }

    private StockAdjustmentService.Result adjust(int delta) {
        return adjustments.adjust(cafeteria, offer, actor, UUID.randomUUID(),
                new AdjustStockRequest(delta, StockAdjustmentReason.CORRECCION_INVENTARIO, null));
    }

    private int stock() {
        return jdbc.queryForObject("SELECT stock FROM offer WHERE id=?", Integer.class, offer);
    }

    private int audits() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM stock_adjustment WHERE offer_id=?", Integer.class, offer);
    }

    private int events() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM catalog_outbox WHERE cuerpo LIKE ?", Integer.class,
                "%" + offer + "%");
    }

    private int availabilityEvents() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM catalog_outbox WHERE event_type=? AND cuerpo LIKE ?",
                Integer.class, "catalog.producto.disponible.v1", "%" + offer + "%");
    }

    private tools.jackson.databind.JsonNode directedEvent() {
        String body = jdbc.queryForObject("""
                SELECT cuerpo FROM catalog_outbox
                WHERE event_type=? AND cuerpo LIKE ?
                """, String.class, "catalog.producto.disponible.v1", "%" + offer + "%");
        return json.readTree(body);
    }

    private void addFollow(UUID userId, UUID cafeteriaId, Timestamp deletedAt) {
        jdbc.update("""
                INSERT INTO product_follow
                    (id, user_id, product_id, cafeteria_id, cafeteria_key, created_at, deleted_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, UUID.randomUUID(), userId, product, cafeteriaId,
                cafeteriaId == null ? new UUID(0, 0) : cafeteriaId, Timestamp.from(NOW), deletedAt);
    }

    private void assertUnchanged() {
        assertThat(stock()).isEqualTo(10);
        assertThat(audits()).isZero();
        assertThat(events()).isZero();
    }

    private ResultActions request(UUID cafeteriaId, UUID offerId, String token, String key, String body) throws Exception {
        return mvc.perform(post(PATH, cafeteriaId, offerId).header("Authorization", "Bearer " + token)
                .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private static String token(UUID actor, String role, UUID cafeteriaClaim) {
        var token = claims().subject(actor.toString()).claim("role", role);
        if (cafeteriaClaim != null) {
            token.claim("cafeteriaId", cafeteriaClaim.toString());
        }
        return sign(token.build(), KEYS, JWSAlgorithm.RS256);
    }
}
