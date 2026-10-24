package cl.cloudcoffee.catalog_service.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

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
import cl.cloudcoffee.catalog_service.dto.ReserveStockRequest;
import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.security.testing.JwtTestSupport;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:stock-reservations;DB_CLOSE_DELAY=-1;MODE=PostgreSQL",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "catalog.reservations.expiration-scan-ms=3600000",
        "management.tracing.enabled=false"
})
@AutoConfigureMockMvc
class StockReservationIntegrationTests extends JwtTestSupport {

    @Autowired
    private StockReservationService reservationService;

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

    private Offer offer;

    @BeforeEach
    void createActiveOffer() {
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
                .isEqualTo(reservationRepository.findByOrderIdAndOfferId(orderId, offer.getId())
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
        reservation.setReservedAt(Instant.now().minusSeconds(600));
        reservation.setExpiresAt(Instant.now().minusSeconds(1));
        reservationRepository.saveAndFlush(reservation);

        reservationService.expireForOffer(offer.getId());

        StockReservation expired = reservationRepository.findByOrderIdAndOfferId(orderId, offer.getId())
                .orElseThrow();
        assertThat(expired.getStatus()).isEqualTo(StockReservationStatus.EXPIRED);
        assertThat(offerRepository.findById(offer.getId()).orElseThrow().getStock()).isEqualTo(1);
        assertThat(reservationService.confirm(orderId, offer.getId()).getStatus())
                .isEqualTo(StockReservationStatus.EXPIRED);
    }

    @Test
    void reservingAfterExpirationUsesRestoredStockWithoutAStaleVersion() {
        var old = reservationService.reserve(new ReserveStockRequest(UUID.randomUUID(), offer.getId(), 1))
                .reservation();
        old.setReservedAt(Instant.now().minusSeconds(600));
        old.setExpiresAt(Instant.now().minusSeconds(1));
        reservationRepository.saveAndFlush(old);

        var replacement = reservationService.reserve(new ReserveStockRequest(UUID.randomUUID(), offer.getId(), 1));

        assertThat(replacement.created()).isTrue();
        assertThat(offerRepository.findById(offer.getId()).orElseThrow().getStock()).isZero();
        assertThat(reservationRepository.findById(old.getId()).orElseThrow().getStatus())
                .isEqualTo(StockReservationStatus.EXPIRED);
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
}
