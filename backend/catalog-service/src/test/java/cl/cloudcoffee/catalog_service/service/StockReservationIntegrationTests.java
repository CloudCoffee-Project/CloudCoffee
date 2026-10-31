package cl.cloudcoffee.catalog_service.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import cl.cloudcoffee.catalog_service.dto.ReserveStockRequest;
import cl.cloudcoffee.catalog_service.messaging.StockEventPublisher;
import cl.cloudcoffee.catalog_service.model.entity.Cafeteria;
import cl.cloudcoffee.catalog_service.model.entity.Campus;
import cl.cloudcoffee.catalog_service.model.entity.Category;
import cl.cloudcoffee.catalog_service.model.entity.Offer;
import cl.cloudcoffee.catalog_service.model.entity.Product;
import cl.cloudcoffee.catalog_service.model.entity.StockReservation;
import cl.cloudcoffee.catalog_service.model.enums.CafeteriaStatus;
import cl.cloudcoffee.catalog_service.model.enums.OfferStatus;
import cl.cloudcoffee.catalog_service.model.enums.ProductStatus;
import cl.cloudcoffee.catalog_service.model.enums.StockReservationStatus;
import cl.cloudcoffee.catalog_service.repository.CafeteriaRepository;
import cl.cloudcoffee.catalog_service.repository.CampusRepository;
import cl.cloudcoffee.catalog_service.repository.CategoryRepository;
import cl.cloudcoffee.catalog_service.repository.OfferRepository;
import cl.cloudcoffee.catalog_service.repository.ProductRepository;
import cl.cloudcoffee.catalog_service.repository.StockReservationRepository;
import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.security.testing.JwtTestSupport;

@SpringBootTest(properties = {
        "spring.datasource.url=${RESERVATION_TEST_DB_URL:jdbc:h2:mem:stock-reservations;DB_CLOSE_DELAY=-1;MODE=PostgreSQL}",
        "spring.datasource.username=${RESERVATION_TEST_DB_USER:sa}",
        "spring.datasource.password=${RESERVATION_TEST_DB_PASSWORD:}",
        "catalog.reservations.expiration-scan-ms=3600000",
        "management.tracing.enabled=false"
})
@AutoConfigureMockMvc
class StockReservationIntegrationTests extends JwtTestSupport {

    private static final Instant NOW = Instant.parse("2026-01-01T00:00:00Z");

    @Autowired
    private StockReservationService reservationService;

    @Autowired
    private ExpiredStockReservationScheduler reservationScheduler;

    @Autowired
    private CampusRepository campusRepository;

    @Autowired
    private CategoryRepository categoryRepository;

    @Autowired
    private CafeteriaRepository cafeteriaRepository;

    @Autowired
    private ProductRepository productRepository;

    @Autowired
    private OfferRepository offerRepository;

    @Autowired
    private StockReservationRepository reservationRepository;

    @Autowired
    private MockMvc mvc;

    @MockitoBean
    private StockEventPublisher stockEventPublisher;

    @MockitoBean
    private Clock clock;

    private Offer offer;

    @BeforeEach
    void createActiveOffer() {
        when(clock.instant()).thenReturn(NOW);

        reservationRepository.deleteAll();
        offerRepository.deleteAll();
        productRepository.deleteAll();
        cafeteriaRepository.deleteAll();
        campusRepository.deleteAll();
        categoryRepository.deleteAll();

        Campus campus = new Campus();
        campus.setName("Campus de prueba");
        campus.setLocation("Temuco");
        campus = campusRepository.save(campus);

        Category category = new Category();
        category.setName("Categoría " + UUID.randomUUID());
        category = categoryRepository.save(category);

        Cafeteria cafeteria = new Cafeteria();
        cafeteria.setCampus(campus);
        cafeteria.setName("Cafetería de prueba");
        cafeteria.setStatus(CafeteriaStatus.OPEN);
        cafeteria = cafeteriaRepository.save(cafeteria);

        Product product = new Product();
        product.setCategory(category);
        product.setName("Producto de prueba");
        product.setStatus(ProductStatus.ACTIVE);
        product = productRepository.save(product);

        offer = new Offer();
        offer.setCafeteria(cafeteria);
        offer.setProduct(product);
        offer.setPrice(java.math.BigDecimal.ONE);
        offer.setStock(1);
        offer.setStatus(OfferStatus.AVAILABLE);
        offer = offerRepository.save(offer);
    }

    @Test
    void repeatedOrderReturnsOriginalReservationWithoutDeductingStockAgain() {
        UUID orderId = UUID.randomUUID();

        var created = reservationService.reserve(new ReserveStockRequest(orderId, offer.getId(), 1));
        var retried = reservationService.reserve(new ReserveStockRequest(orderId, offer.getId(), 1));

        assertThat(created.created()).isTrue();
        assertThat(retried.created()).isFalse();
        assertThat(retried.reservation().getOrderId()).isEqualTo(orderId);
        assertThat(retried.reservation().getExpiresAt())
                .isEqualTo(reservationRepository.findByOrderIdAndOfferIdAndAttemptId(orderId, offer.getId(), StockReservation.LEGACY_ATTEMPT_ID)
                        .orElseThrow().getExpiresAt());
        assertThat(offerRepository.findById(offer.getId()).orElseThrow().getStock()).isZero();
    }

    @Test
    void rejectsNonPositiveQuantityAndChangedReplay() {
        assertThatThrownBy(() -> reservationService.reserve(
                new ReserveStockRequest(UUID.randomUUID(), offer.getId(), 0)))
                .isInstanceOf(BusinessException.class);

        UUID orderId = UUID.randomUUID();
        reservationService.reserve(new ReserveStockRequest(orderId, offer.getId(), 1));
        assertThatThrownBy(() -> reservationService.reserve(
                new ReserveStockRequest(orderId, offer.getId(), 2)))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void simultaneousOrdersCannotReserveTheSameLastUnit() throws Exception {
        try (var executor = Executors.newFixedThreadPool(8)) {
            List<Callable<Boolean>> requests = new ArrayList<>();
            for (int index = 0; index < 8; index++) {
                UUID orderId = UUID.randomUUID();
                requests.add(() -> {
                    try {
                        return reservationService.reserve(
                                new ReserveStockRequest(orderId, offer.getId(), 1)).created();
                    } catch (BusinessException exception) {
                        return false;
                    }
                });
            }

            long successfulReservations = executor.invokeAll(requests).stream()
                    .mapToLong(future -> {
                        try {
                            return future.get() ? 1 : 0;
                        } catch (Exception exception) {
                            throw new IllegalStateException(exception);
                        }
                    }).sum();

            assertThat(successfulReservations).isEqualTo(1);
            assertThat(offerRepository.findById(offer.getId()).orElseThrow().getStock()).isZero();
            assertThat(reservationRepository.count()).isEqualTo(1);
        }
    }

    @Test
    void expiredReservationReleasesStockAndCannotBeConfirmed() {
        UUID orderId = UUID.randomUUID();
        var reservation = reservationService.reserve(new ReserveStockRequest(orderId, offer.getId(), 1))
                .reservation();
        reservation.setReservedAt(NOW.minusSeconds(600));
        reservation.setExpiresAt(NOW.minusSeconds(1));
        reservationRepository.saveAndFlush(reservation);

        reservationService.expireForOffer(offer.getId());

        StockReservation expired = reservationRepository.findByOrderIdAndOfferIdAndAttemptId(orderId, offer.getId(), StockReservation.LEGACY_ATTEMPT_ID)
                .orElseThrow();
        assertThat(expired.getStatus()).isEqualTo(StockReservationStatus.EXPIRED);
        assertThat(offerRepository.findById(offer.getId()).orElseThrow().getStock()).isEqualTo(1);
        assertThat(reservationService.confirm(orderId, offer.getId()).getStatus())
                .isEqualTo(StockReservationStatus.EXPIRED);
    }

    @Test
    void expirationSchedulerIsIdempotentAndDoesNotReleaseConfirmedReservations() {
        offer.setStock(2);
        offerRepository.saveAndFlush(offer);

        var expiredOrderId = UUID.randomUUID();
        var confirmedOrderId = UUID.randomUUID();
        StockReservation expired = reservationService.reserve(
                new ReserveStockRequest(expiredOrderId, offer.getId(), 1)).reservation();
        StockReservation confirmed = reservationService.reserve(
                new ReserveStockRequest(confirmedOrderId, offer.getId(), 1)).reservation();
        confirmed = reservationService.confirm(confirmedOrderId, offer.getId());

        expired.setReservedAt(NOW.minusSeconds(600));
        expired.setExpiresAt(NOW.minusSeconds(1));
        confirmed.setReservedAt(NOW.minusSeconds(600));
        confirmed.setExpiresAt(NOW.minusSeconds(1));
        reservationRepository.saveAllAndFlush(List.of(expired, confirmed));

        reservationScheduler.releaseExpiredReservations();
        reservationScheduler.releaseExpiredReservations();

        assertThat(reservationRepository.findByOrderIdAndOfferIdAndAttemptId(expiredOrderId, offer.getId(), StockReservation.LEGACY_ATTEMPT_ID)
                .orElseThrow().getStatus()).isEqualTo(StockReservationStatus.EXPIRED);
        assertThat(reservationRepository.findByOrderIdAndOfferIdAndAttemptId(confirmedOrderId, offer.getId(), StockReservation.LEGACY_ATTEMPT_ID)
                .orElseThrow().getStatus()).isEqualTo(StockReservationStatus.CONFIRMED);
        assertThat(offerRepository.findById(offer.getId()).orElseThrow().getStock()).isEqualTo(1);
        verify(stockEventPublisher, times(3)).publishStockUpdated(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void confirmingReservationIsIdempotentByReservationId() {
        var reservation = reservationService.reserve(
                new ReserveStockRequest(UUID.randomUUID(), offer.getId(), 1)).reservation();

        StockReservation confirmed = reservationService.confirm(reservation.getId());
        StockReservation repeated = reservationService.confirm(reservation.getId());

        assertThat(confirmed.getStatus()).isEqualTo(StockReservationStatus.CONFIRMED);
        assertThat(repeated.getStatus()).isEqualTo(StockReservationStatus.CONFIRMED);
        assertThat(offerRepository.findById(offer.getId()).orElseThrow().getStock()).isZero();
    }

    @Test
    void releasingReservationIsIdempotentByReservationId() {
        var reservation = reservationService.reserve(
                new ReserveStockRequest(UUID.randomUUID(), offer.getId(), 1)).reservation();

        StockReservation released = reservationService.release(reservation.getId());
        StockReservation repeated = reservationService.release(reservation.getId());

        assertThat(released.getStatus()).isEqualTo(StockReservationStatus.RELEASED);
        assertThat(repeated.getStatus()).isEqualTo(StockReservationStatus.RELEASED);
        assertThat(offerRepository.findById(offer.getId()).orElseThrow().getStock()).isEqualTo(1);
        verify(stockEventPublisher, times(2)).publishStockUpdated(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void internalEndpointReleasesReservationByReservationId() throws Exception {
        StockReservation reservation = reservationService.reserve(
                new ReserveStockRequest(UUID.randomUUID(), offer.getId(), 1)).reservation();

        mvc.perform(post("/internal/servicios/catalogo/reservas/{reservationId}/liberar",
                        reservation.getId())
                        .header("X-Internal-Service-Token", INTERNAL_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reservationId").value(reservation.getId().toString()))
                .andExpect(jsonPath("$.status").value("RELEASED"));
    }

    @Test
    void doesNotReserveInactiveOffer() {
        offer.setStatus(OfferStatus.OUT_OF_STOCK);
        offerRepository.saveAndFlush(offer);

        assertThatThrownBy(() -> reservationService.reserve(
                new ReserveStockRequest(UUID.randomUUID(), offer.getId(), 1)))
                .isInstanceOf(BusinessException.class);
        assertThat(offerRepository.findById(offer.getId()).orElseThrow().getStock()).isEqualTo(1);
    }

    @Test
    void internalEndpointRequiresServiceToken() throws Exception {
        UUID orderId = UUID.randomUUID();
        String body = """
                {"orderId":"%s","offerId":"%s","quantity":1}
                """.formatted(orderId, offer.getId());

        mvc.perform(post("/internal/servicios/catalogo/reservas")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/internal/servicios/catalogo/reservas")
                        .header("Authorization", "Bearer " + token())
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isForbidden());
        mvc.perform(post("/internal/servicios/catalogo/reservas")
                        .header("X-Internal-Service-Token", INTERNAL_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.orderId").value(orderId.toString()))
                .andExpect(jsonPath("$.status").value("RESERVED"));
    }

    @Test
    void oneOrderCanReserveSeveralOffers() {
        Category secondCategory = new Category();
        secondCategory.setName("Otra categoría " + UUID.randomUUID());
        secondCategory = categoryRepository.save(secondCategory);

        Product secondProduct = new Product();
        secondProduct.setCategory(secondCategory);
        secondProduct.setName("Otro producto");
        secondProduct.setStatus(ProductStatus.ACTIVE);
        secondProduct = productRepository.save(secondProduct);

        Offer secondOffer = new Offer();
        secondOffer.setCafeteria(offer.getCafeteria());
        secondOffer.setProduct(secondProduct);
        secondOffer.setPrice(java.math.BigDecimal.ONE);
        secondOffer.setStock(1);
        secondOffer.setStatus(OfferStatus.AVAILABLE);
        secondOffer = offerRepository.save(secondOffer);

        UUID orderId = UUID.randomUUID();
        var firstReservation = reservationService.reserve(
                new ReserveStockRequest(orderId, offer.getId(), 1));
        var secondReservation = reservationService.reserve(
                new ReserveStockRequest(orderId, secondOffer.getId(), 1));

        assertThat(firstReservation.created()).isTrue();
        assertThat(secondReservation.created()).isTrue();
        assertThat(reservationRepository.count()).isEqualTo(2);
    }

    @Test
    void newAttemptAfterCompensationPreservesHistoryAndIgnoresLateLegacyCommands() {
        UUID orderId = UUID.randomUUID();
        var old = reservationService.reserve(new ReserveStockRequest(orderId, offer.getId(), 1)).reservation();
        reservationService.release(old.getId());
        UUID attemptId = UUID.randomUUID();
        var request = new ReserveStockRequest(orderId, offer.getId(), 1, attemptId);
        var next = reservationService.reserve(request);
        var replay = reservationService.reserve(request);

        assertThat(next.created()).isTrue();
        assertThat(next.reservation().getId()).isNotEqualTo(old.getId());
        assertThat(replay.created()).isFalse();
        assertThat(replay.reservation().getId()).isEqualTo(next.reservation().getId());
        assertThat(reservationService.release(old.getId()).getStatus()).isEqualTo(StockReservationStatus.RELEASED);
        assertThat(reservationService.release(orderId, offer.getId()).getId()).isEqualTo(old.getId());
        assertThatThrownBy(() -> reservationService.confirm(old.getId())).isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> reservationService.confirm(orderId, offer.getId()))
                .isInstanceOf(BusinessException.class);
        var oldReplay = reservationService.reserve(new ReserveStockRequest(orderId, offer.getId(), 1));
        assertThat(oldReplay.created()).isFalse();
        assertThat(oldReplay.reservation().getStatus()).isEqualTo(StockReservationStatus.RELEASED);
        assertThat(reservationRepository.findById(next.reservation().getId()).orElseThrow().getStatus())
                .isEqualTo(StockReservationStatus.RESERVED);
        assertThat(offerRepository.findById(offer.getId()).orElseThrow().getStock()).isZero();
        assertThat(reservationRepository.count()).isEqualTo(2);
        assertThatThrownBy(() -> reservationService.reserve(
                new ReserveStockRequest(orderId, offer.getId(), 2, attemptId)))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void explicitAttemptCanBeRetriedAfterExpirationWithoutRevivingTheOldOne() {
        UUID orderId = UUID.randomUUID();
        var oldRequest = new ReserveStockRequest(orderId, offer.getId(), 1, UUID.randomUUID());
        var old = reservationService.reserve(oldRequest).reservation();
        when(clock.instant()).thenReturn(NOW.plusSeconds(301));
        var next = reservationService.reserve(
                new ReserveStockRequest(orderId, offer.getId(), 1, UUID.randomUUID())).reservation();

        assertThat(reservationService.reserve(oldRequest).reservation().getStatus())
                .isEqualTo(StockReservationStatus.EXPIRED);
        assertThat(reservationService.confirm(old.getId()).getStatus()).isEqualTo(StockReservationStatus.EXPIRED);
        assertThat(reservationService.release(old.getId()).getStatus()).isEqualTo(StockReservationStatus.EXPIRED);
        assertThat(reservationRepository.findById(next.getId()).orElseThrow().getStatus())
                .isEqualTo(StockReservationStatus.RESERVED);
        assertThat(offerRepository.findById(offer.getId()).orElseThrow().getStock()).isZero();
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void activeOrConfirmedReservationRejectsAnotherAttemptEvenWithEnoughStock(boolean confirmed) {
        offer.setStock(3);
        offerRepository.saveAndFlush(offer);
        UUID orderId = UUID.randomUUID();
        var original = reservationService.reserve(
                new ReserveStockRequest(orderId, offer.getId(), 1, UUID.randomUUID())).reservation();
        if (confirmed) {
            reservationService.confirm(original.getId());
        }
        assertThatThrownBy(() -> reservationService.reserve(
                new ReserveStockRequest(orderId, offer.getId(), 1, UUID.randomUUID())))
                .isInstanceOf(BusinessException.class)
                .satisfies(e -> assertThat(((BusinessException) e).getStatus().value()).isEqualTo(409));
        assertThat(offerRepository.findById(offer.getId()).orElseThrow().getStock()).isEqualTo(2);
        assertThat(reservationRepository.count()).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void concurrentAttemptsAfterCompensationAllocateOnce(boolean sameAttempt) throws Exception {
        offer.setStock(8);
        offerRepository.saveAndFlush(offer);
        UUID orderId = UUID.randomUUID();
        var original = reservationService.reserve(
                new ReserveStockRequest(orderId, offer.getId(), 1, UUID.randomUUID())).reservation();
        reservationService.release(original.getId());
        UUID attemptId = UUID.randomUUID();
        try (var executor = Executors.newFixedThreadPool(8)) {
            List<Callable<Boolean>> requests = new ArrayList<>();
            for (int i = 0; i < 8; i++) {
                UUID key = sameAttempt ? attemptId : UUID.randomUUID();
                requests.add(() -> {
                    try {
                        return reservationService.reserve(
                                new ReserveStockRequest(orderId, offer.getId(), 1, key)).created();
                    } catch (BusinessException e) {
                        assertThat(e.getStatus().value()).isEqualTo(409);
                        return false;
                    }
                });
            }
            int creations = 0;
            for (var future : executor.invokeAll(requests)) {
                if (future.get()) {
                    creations++;
                }
            }
            assertThat(creations).isEqualTo(1);
        }
        assertThat(offerRepository.findById(offer.getId()).orElseThrow().getStock()).isEqualTo(7);
        assertThat(reservationRepository.count()).isEqualTo(2);
    }

    @Test
    void explicitAttemptIsReturnedOverHttpAndLegacyPairRoutesCannotTargetIt() throws Exception {
        UUID orderId = UUID.randomUUID();
        UUID attemptId = UUID.randomUUID();
        String body = """
                {"orderId":"%s","offerId":"%s","quantity":1,"attemptId":"%s"}
                """.formatted(orderId, offer.getId(), attemptId);
        mvc.perform(post("/internal/servicios/catalogo/reservas")
                        .header("X-Internal-Service-Token", INTERNAL_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.attemptId").value(attemptId.toString()));
        mvc.perform(post("/internal/servicios/catalogo/reservas")
                        .header("X-Internal-Service-Token", INTERNAL_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk()).andExpect(jsonPath("$.attemptId").value(attemptId.toString()));
        mvc.perform(post("/internal/servicios/catalogo/reservas/{orderId}/{offerId}/liberar", orderId, offer.getId())
                        .header("X-Internal-Service-Token", INTERNAL_TOKEN))
                .andExpect(status().isNotFound());
        assertThat(offerRepository.findById(offer.getId()).orElseThrow().getStock()).isZero();
    }
}
