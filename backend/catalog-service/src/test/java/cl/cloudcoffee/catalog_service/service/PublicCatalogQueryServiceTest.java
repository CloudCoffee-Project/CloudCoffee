package cl.cloudcoffee.catalog_service.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

import cl.cloudcoffee.catalog_service.dto.CafeteriaSummaryResponse;
import cl.cloudcoffee.catalog_service.dto.CampusResponse;
import cl.cloudcoffee.catalog_service.dto.CategoryResponse;
import cl.cloudcoffee.catalog_service.dto.ProductOfferResponse;
import cl.cloudcoffee.catalog_service.dto.ProductResponse;
import cl.cloudcoffee.catalog_service.model.entity.Cafeteria;
import cl.cloudcoffee.catalog_service.model.entity.Campus;
import cl.cloudcoffee.catalog_service.model.entity.Category;
import cl.cloudcoffee.catalog_service.model.entity.Offer;
import cl.cloudcoffee.catalog_service.model.entity.Product;
import cl.cloudcoffee.catalog_service.model.enums.ProductStatus;
import cl.cloudcoffee.catalog_service.repository.CampusRepository;
import cl.cloudcoffee.catalog_service.repository.CategoryRepository;
import cl.cloudcoffee.catalog_service.repository.OfferRepository;
import cl.cloudcoffee.catalog_service.repository.ProductRepository;

@ExtendWith(MockitoExtension.class)
class PublicCatalogQueryServiceTest {

    @Mock
    private CampusRepository campusRepository;

    @Mock
    private CategoryRepository categoryRepository;

    @Mock
    private ProductRepository productRepository;

    @Mock
    private OfferRepository offerRepository;

    @InjectMocks
    private PublicCatalogQueryService queryService;

    @Test
    void mapsCampusAndOrdersItsCafeteriasByName() {
        UUID campusId = UUID.randomUUID();
        UUID cafeteriaSurId = UUID.randomUUID();
        UUID cafeteriaCentralId = UUID.randomUUID();

        Campus campus = new Campus();
        campus.setId(campusId);
        campus.setName("Campus San Francisco");
        campus.setLocation("Manuel Montt 056, Temuco");

        Cafeteria cafeteriaSur = new Cafeteria();
        cafeteriaSur.setId(cafeteriaSurId);
        cafeteriaSur.setName("Cafetería Sur");

        Cafeteria cafeteriaCentral = new Cafeteria();
        cafeteriaCentral.setId(cafeteriaCentralId);
        cafeteriaCentral.setName("Cafetería Central");

        campus.setCafeterias(List.of(cafeteriaSur, cafeteriaCentral));
        when(campusRepository.findAllWithCafeteriasOrderByName()).thenReturn(List.of(campus));

        assertThat(queryService.findAllCampus()).containsExactly(
                new CampusResponse(
                        campusId,
                        "Campus San Francisco",
                        "Manuel Montt 056, Temuco",
                        List.of(
                                new CafeteriaSummaryResponse(cafeteriaCentralId, "Cafetería Central"),
                                new CafeteriaSummaryResponse(cafeteriaSurId, "Cafetería Sur")
                        )
                )
        );
    }

    @Test
    void mapsCategoriesToPublicDtos() {
        UUID categoryId = UUID.randomUUID();
        Category category = new Category();
        category.setId(categoryId);
        category.setName("Bebidas");
        category.setDescription("Bebidas frías y calientes");

        when(categoryRepository.findAllByOrderByNameAsc()).thenReturn(List.of(category));

        assertThat(queryService.findAllCategories()).containsExactly(
                new CategoryResponse(categoryId, "Bebidas")
        );
    }

    @Test
    void passesProductFiltersToRepositoryAndMapsPage() {
        UUID campusId = UUID.randomUUID();
        UUID categoryId = UUID.randomUUID();
        Pageable pageable = PageRequest.of(1, 5);
        Product product = product(categoryId, "Café americano");

        when(productRepository.findAvailableProducts(campusId, categoryId, "café", pageable))
                .thenReturn(new PageImpl<>(List.of(product), pageable, 6));

        Page<ProductResponse> page = queryService.findProducts(campusId, categoryId, "café", pageable);

        assertThat(page.getContent()).containsExactly(new ProductResponse(
                product.getId(), categoryId, "Café americano", "Descripción de Café americano",
                "https://example.com/producto.png", "ACTIVE"));
        assertThat(page.getTotalElements()).isEqualTo(6);
        assertThat(page.getNumber()).isEqualTo(1);
    }

    @Test
    void mapsOffersKeepingRepositoryPriceOrderAndStockAvailability() {
        UUID productId = UUID.randomUUID();
        UUID campusId = UUID.randomUUID();
        Offer barata = offer("Cafetería Biblioteca", "1300.00", 3);
        Offer agotada = offer("Cafetería Central", "1500.00", 0);

        when(offerRepository.findOffersByProductAndCampus(productId, campusId))
                .thenReturn(List.of(barata, agotada));

        List<ProductOfferResponse> offers = queryService.findProductOffers(productId, campusId);

        assertThat(offers).extracting(ProductOfferResponse::getCafeteriaName)
                .containsExactly("Cafetería Biblioteca", "Cafetería Central");
        assertThat(offers).extracting(ProductOfferResponse::getPrice)
                .containsExactly(new BigDecimal("1300.00"), new BigDecimal("1500.00"));
        assertThat(offers).extracting(ProductOfferResponse::getDisponible).containsExactly(true, false);
        assertThat(offers.get(0).getCafeteriaId()).isEqualTo(barata.getCafeteria().getId());
    }

    private static Product product(UUID categoryId, String name) {
        Category category = new Category();
        category.setId(categoryId);
        Product product = new Product();
        product.setId(UUID.randomUUID());
        product.setCategory(category);
        product.setName(name);
        product.setDescription("Descripción de " + name);
        product.setImageUrl("https://example.com/producto.png");
        product.setStatus(ProductStatus.ACTIVE);
        return product;
    }

    private static Offer offer(String cafeteriaName, String price, int stock) {
        Cafeteria cafeteria = new Cafeteria();
        cafeteria.setId(UUID.randomUUID());
        cafeteria.setName(cafeteriaName);
        Offer offer = new Offer();
        offer.setId(UUID.randomUUID());
        offer.setCafeteria(cafeteria);
        offer.setPrice(new BigDecimal(price));
        offer.setStock(stock);
        return offer;
    }
}
