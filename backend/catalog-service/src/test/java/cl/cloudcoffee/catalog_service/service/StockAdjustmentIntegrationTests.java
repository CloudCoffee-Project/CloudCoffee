package cl.cloudcoffee.catalog_service.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import com.nimbusds.jose.JWSAlgorithm;

import cl.cloudcoffee.catalog_service.dto.AdjustStockRequest;
import cl.cloudcoffee.catalog_service.dto.ReserveStockRequest;
import cl.cloudcoffee.catalog_service.messaging.RabbitTopologyConfig;
import cl.cloudcoffee.catalog_service.messaging.StockEventPublisher;
import cl.cloudcoffee.catalog_service.model.entity.Cafeteria;
import cl.cloudcoffee.catalog_service.model.entity.Campus;
import cl.cloudcoffee.catalog_service.model.entity.Category;
import cl.cloudcoffee.catalog_service.model.entity.Offer;
import cl.cloudcoffee.catalog_service.model.entity.Product;
import cl.cloudcoffee.catalog_service.model.enums.CafeteriaStatus;
import cl.cloudcoffee.catalog_service.model.enums.OfferStatus;
import cl.cloudcoffee.catalog_service.model.enums.ProductStatus;
import cl.cloudcoffee.catalog_service.model.enums.StockReservationStatus;
import cl.cloudcoffee.catalog_service.repository.CafeteriaRepository;
import cl.cloudcoffee.catalog_service.repository.CampusRepository;
import cl.cloudcoffee.catalog_service.repository.CategoryRepository;
import cl.cloudcoffee.catalog_service.repository.OfferRepository;
import cl.cloudcoffee.catalog_service.repository.ProductRepository;
import cl.cloudcoffee.catalog_service.repository.StockAdjustmentRepository;
import cl.cloudcoffee.catalog_service.repository.StockReservationRepository;
import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.security.AsignacionNoVerificableException;
import cl.cloudcoffee.security.AsignacionesCafeteria;
import cl.cloudcoffee.security.testing.JwtTestSupport;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:stock-adjustments;DB_CLOSE_DELAY=-1;MODE=PostgreSQL;LOCK_TIMEOUT=10000",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "catalog.reservations.expiration-scan-ms=3600000"
})
@AutoConfigureMockMvc
class StockAdjustmentIntegrationTests extends JwtTestSupport {
    private static final UUID ADMIN = UUID.randomUUID();
    @Autowired StockAdjustmentService adjustmentService;
    @Autowired StockReservationService reservationService;
    @Autowired StockAdjustmentRepository adjustmentRepository;
    @Autowired StockReservationRepository reservationRepository;
    @Autowired OfferRepository offerRepository;
    @Autowired ProductRepository productRepository;
    @Autowired CafeteriaRepository cafeteriaRepository;
    @Autowired CategoryRepository categoryRepository;
    @Autowired CampusRepository campusRepository;
    @Autowired PlatformTransactionManager transactionManager;
    @Autowired MockMvc mvc;
    @MockitoBean AsignacionesCafeteria assignments;
    @MockitoBean RabbitTemplate rabbitTemplate;

    private Offer offer;
    private UUID cafeteriaId;

    @BeforeEach
    void createOffer() {
        adjustmentRepository.deleteAll();
        reservationRepository.deleteAll();
        offerRepository.deleteAll();
        productRepository.deleteAll();
        cafeteriaRepository.deleteAll();
        categoryRepository.deleteAll();
        campusRepository.deleteAll();

        Campus campus = new Campus();
        campus.setName("Campus ajuste");
        campus = campusRepository.save(campus);
        Category category = new Category();
        category.setName("Categoría ajuste");
        category = categoryRepository.save(category);
        Cafeteria cafeteria = new Cafeteria();
        cafeteria.setCampus(campus);
        cafeteria.setName("Cafetería ajuste");
        cafeteria.setStatus(CafeteriaStatus.OPEN);
        cafeteria = cafeteriaRepository.save(cafeteria);
        cafeteriaId = cafeteria.getId();
        Product product = new Product();
        product.setCategory(category);
        product.setName("Producto ajuste");
        product.setStatus(ProductStatus.ACTIVE);
        product = productRepository.save(product);
        offer = new Offer();
        offer.setCafeteria(cafeteria);
        offer.setProduct(product);
        offer.setPrice(BigDecimal.ONE);
        offer.setStock(10);
        offer.setStatus(OfferStatus.AVAILABLE);
        offer = offerRepository.saveAndFlush(offer);
        when(assignments.cafeteriaDe(any())).thenReturn(Optional.empty());
        when(assignments.cafeteriaDe(ADMIN)).thenReturn(Optional.of(cafeteriaId));
        clearInvocations(rabbitTemplate);
    }

    @Test
    void assignedAdminAdjustsAndRecordsActorAndPublishesCommittedStock() throws Exception {
        adjustHttp(cafeteriaId, offer.getId(), signedToken(ADMIN, "ADMIN_CAFETERIA", null), "{\"quantity\":20}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.quantity").value(20))
                .andExpect(jsonPath("$.previousStock").value(10))
                .andExpect(jsonPath("$.stock").value(20))
                .andExpect(jsonPath("$.reservedQuantity").value(0));

        var adjustment = adjustmentRepository.findAll().getFirst();
        assertThat(adjustment.getAdjustedBy()).isEqualTo(ADMIN);
        assertThat(adjustment.getAdjustedAt()).isNotNull();
        var captured = ArgumentCaptor.forClass(Object.class);
        verify(rabbitTemplate).convertAndSend(eq(RabbitTopologyConfig.EVENTS_EXCHANGE),
                eq(StockEventPublisher.EVENT_TYPE), captured.capture());
        var envelope = (Map<?, ?>) captured.getValue();
        assertThat(envelope.get("eventId")).isInstanceOf(UUID.class);
        assertThat(envelope.get("traceId").toString()).isNotBlank();
        var payload = (Map<?, ?>) envelope.get("payload");
        assertThat(payload.get("ofertaId")).isEqualTo(offer.getId());
        assertThat(payload.get("productoId")).isEqualTo(offer.getProduct().getId());
        assertThat(payload.get("cafeteriaId")).isEqualTo(cafeteriaId);
        assertThat(payload.get("campusId")).isEqualTo(offer.getCafeteria().getCampus().getId());
        assertThat(payload.get("stockActual")).isEqualTo(20);
        assertThat(payload.get("version")).isEqualTo(adjustment.getVersion());
        assertThat(currentOffer().getStock()).isEqualTo(20);
    }

    @ParameterizedTest
    @ValueSource(strings = {"CAJERO", "CLIENTE", "SUPER_ADMIN"})
    void otherRolesCannotAdjustEvenWithAnAssignment(String role) throws Exception {
        adjustHttp(cafeteriaId, offer.getId(), signedToken(ADMIN, role, null), "{\"quantity\":20}")
                .andExpect(status().isForbidden());
        assertUnchanged();
    }

    @Test
    void foreignCafeteriaAndUnassignedAdminCannotUseTheTokenClaimToAuthorize() throws Exception {
        UUID foreign = UUID.randomUUID();
        adjustHttp(foreign, offer.getId(), signedToken(ADMIN, "ADMIN_CAFETERIA", foreign), "{\"quantity\":20}")
                .andExpect(status().isForbidden());
        adjustHttp(cafeteriaId, offer.getId(), signedToken(UUID.randomUUID(), "ADMIN_CAFETERIA", cafeteriaId), "{\"quantity\":20}")
                .andExpect(status().isForbidden());
        assertUnchanged();
    }

    @Test
    void foreignOfferCannotBeAdjustedThroughTheAssignedCafeteriaPath() throws Exception {
        Cafeteria foreign = new Cafeteria();
        foreign.setCampus(offer.getCafeteria().getCampus());
        foreign.setName("Ajena");
        foreign.setStatus(CafeteriaStatus.OPEN);
        offer.setCafeteria(cafeteriaRepository.save(foreign));
        offerRepository.saveAndFlush(offer);
        adjustHttp(cafeteriaId, offer.getId(), signedToken(ADMIN, "ADMIN_CAFETERIA", null), "{\"quantity\":20}")
                .andExpect(status().isNotFound());
        assertUnchanged();
    }

    @Test
    void authUnavailableFailsClosedAndAnonymousRequestsAreRejected() throws Exception {
        when(assignments.cafeteriaDe(ADMIN)).thenThrow(new AsignacionNoVerificableException("Auth no disponible", null));
        adjustHttp(cafeteriaId, offer.getId(), signedToken(ADMIN, "ADMIN_CAFETERIA", null), "{\"quantity\":20}")
                .andExpect(status().isForbidden());
        mvc.perform(put(path(), cafeteriaId, offer.getId()).contentType(MediaType.APPLICATION_JSON).content("{\"quantity\":20}"))
                .andExpect(status().isUnauthorized());
        assertUnchanged();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"quantity\":null}", "{\"quantity\":-1}", "{\"quantity\":2147483648}",
            "{\"quantity\":-0.5}", "{\"quantity\":1.5}", "{\"quantity\":\"20\"}"})
    void invalidQuantityDoesNotRecordOrPublish(String body) throws Exception {
        adjustHttp(cafeteriaId, offer.getId(), signedToken(ADMIN, "ADMIN_CAFETERIA", null), body)
                .andExpect(status().isBadRequest());
        assertUnchanged();
    }

    @Test
    void zeroMarksOutOfStockAndReplenishmentReopensTheOffer() {
        assertThat(adjust(0).stock()).isZero();
        assertThat(currentOffer().getStatus()).isEqualTo(OfferStatus.OUT_OF_STOCK);
        assertThat(adjust(5).stock()).isEqualTo(5);
        assertThat(currentOffer().getStatus()).isEqualTo(OfferStatus.AVAILABLE);
    }

    @Test
    void correctionProtectsReservedUnitsAndReleaseRestoresOnlyThoseUnits() {
        UUID orderId = UUID.randomUUID();
        reservationService.reserve(new ReserveStockRequest(orderId, offer.getId(), 4));
        assertThatThrownBy(() -> adjust(3)).isInstanceOfSatisfying(BusinessException.class,
                error -> assertThat(error.getCode()).isEqualTo("STOCK_COMPROMETIDO"));
        assertThat(currentOffer().getStock()).isEqualTo(6);
        assertThat(adjustmentRepository.count()).isZero();
        verifyNoInteractions(rabbitTemplate);

        var result = adjust(6);
        assertThat(result.reservedQuantity()).isEqualTo(4);
        assertThat(result.stock()).isEqualTo(2);
        assertThat(result.version()).isGreaterThan(1);
        reservationService.release(orderId, offer.getId());
        assertThat(currentOffer().getStock()).isEqualTo(6);
    }

    @Test
    void totalEqualToReservationsLeavesNoSellableStockAndConfirmationDoesNotRestoreIt() {
        UUID orderId = UUID.randomUUID();
        reservationService.reserve(new ReserveStockRequest(orderId, offer.getId(), 4));
        assertThat(adjust(4).stock()).isZero();
        assertThat(currentOffer().getStatus()).isEqualTo(OfferStatus.OUT_OF_STOCK);
        reservationService.confirm(orderId, offer.getId());
        assertThat(currentOffer().getStock()).isZero();
    }

    @Test
    void expiredReservationsCannotAddStockAfterTheCorrection() {
        UUID orderId = UUID.randomUUID();
        var reservation = reservationService.reserve(new ReserveStockRequest(orderId, offer.getId(), 4)).reservation();
        reservation.setReservedAt(Instant.now().minusSeconds(600));
        reservation.setExpiresAt(Instant.now().minusSeconds(1));
        reservationRepository.saveAndFlush(reservation);
        assertThat(adjust(2).stock()).isEqualTo(2);
        reservationService.expireForOffer(offer.getId());
        assertThat(currentOffer().getStock()).isEqualTo(2);
        assertThat(reservationRepository.findById(reservation.getId()).orElseThrow().getStatus())
                .isEqualTo(StockReservationStatus.EXPIRED);
    }

    @Test
    void rollbackDoesNotLeaveAnAdjustmentOrPublishAnEvent() {
        new TransactionTemplate(transactionManager).executeWithoutResult(transaction -> {
            adjust(20);
            verifyNoInteractions(rabbitTemplate);
            transaction.setRollbackOnly();
        });
        assertUnchanged();
    }

    @Test
    void adjustmentWaitsForConcurrentReservationAndUsesItsCommittedQuantity() throws Exception {
        runWhileOfferLocked(() -> reservationService.reserve(new ReserveStockRequest(UUID.randomUUID(), offer.getId(), 4)),
                () -> {
                    var result = adjust(6);
                    assertThat(result.reservedQuantity()).isEqualTo(4);
                    assertThat(result.stock()).isEqualTo(2);
                });
        assertThat(currentOffer().getStock()).isEqualTo(2);
        assertThat(reservationRepository.count()).isEqualTo(1);
    }

    @Test
    void reservationWaitsForAdjustmentAndCannotOversellTheCorrectedStock() throws Exception {
        runWhileOfferLocked(() -> adjust(2), () ->
                assertThatThrownBy(() -> reservationService.reserve(new ReserveStockRequest(UUID.randomUUID(), offer.getId(), 3)))
                        .isInstanceOfSatisfying(BusinessException.class,
                                error -> assertThat(error.getCode()).isEqualTo("STOCK_NO_DISPONIBLE")));
        assertThat(currentOffer().getStock()).isEqualTo(2);
        assertThat(reservationRepository.count()).isZero();
    }

    @Test
    void concurrentAdjustmentsRecordTheSerializedPreviousStock() throws Exception {
        runWhileOfferLocked(() -> adjust(5), () -> {
            var second = adjust(8);
            assertThat(second.previousStock()).isEqualTo(5);
            assertThat(second.stock()).isEqualTo(8);
        });
        assertThat(adjustmentRepository.count()).isEqualTo(2);
        assertThat(currentOffer().getStock()).isEqualTo(8);
        assertThat(currentOffer().getVersion()).isEqualTo(2);
    }

    private void runWhileOfferLocked(Runnable firstOperation, Runnable secondOperation) throws Exception {
        CountDownLatch locked = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch secondStarted = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> new TransactionTemplate(transactionManager).executeWithoutResult(tx -> {
                offerRepository.findByIdForUpdate(offer.getId()).orElseThrow();
                firstOperation.run();
                locked.countDown();
                await(release);
            }));
            try {
                assertThat(locked.await(10, TimeUnit.SECONDS)).isTrue();
                var second = executor.submit(() -> {
                    secondStarted.countDown();
                    secondOperation.run();
                });
                assertThat(secondStarted.await(10, TimeUnit.SECONDS)).isTrue();
                assertThatThrownBy(() -> second.get(200, TimeUnit.MILLISECONDS))
                        .isInstanceOf(java.util.concurrent.TimeoutException.class);
                release.countDown();
                first.get(10, TimeUnit.SECONDS);
                second.get(10, TimeUnit.SECONDS);
            } finally {
                release.countDown();
            }
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Tiempo de espera agotado");
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(exception);
        }
    }

    private cl.cloudcoffee.catalog_service.dto.StockAdjustmentResponse adjust(int quantity) {
        Jwt jwt = Jwt.withTokenValue("test").header("alg", "RS256").subject(ADMIN.toString())
                .claim("role", "ADMIN_CAFETERIA").build();
        Authentication authentication = new JwtAuthenticationToken(jwt);
        return adjustmentService.adjust(cafeteriaId, offer.getId(), new AdjustStockRequest(quantity), authentication);
    }

    private Offer currentOffer() {
        return offerRepository.findById(offer.getId()).orElseThrow();
    }

    private void assertUnchanged() {
        assertThat(currentOffer().getStock()).isEqualTo(10);
        assertThat(adjustmentRepository.count()).isZero();
        verifyNoInteractions(rabbitTemplate);
    }

    private ResultActions adjustHttp(UUID cafeteria, UUID offerId, String token, String body) throws Exception {
        return mvc.perform(put(path(), cafeteria, offerId).header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private static String path() {
        return "/catalog/cafeterias/{cafeteriaId}/ofertas/{offerId}/stock";
    }

    private static String signedToken(UUID user, String role, UUID cafeteriaClaim) {
        var claims = claims().subject(user.toString()).claim("role", role);
        if (cafeteriaClaim != null) claims.claim("cafeteriaId", cafeteriaClaim.toString());
        return sign(claims.build(), KEYS, JWSAlgorithm.RS256);
    }
}
