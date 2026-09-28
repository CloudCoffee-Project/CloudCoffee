package cl.cloudcoffee.catalog_service.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import cl.cloudcoffee.catalog_service.dto.CafeteriaSummaryResponse;
import cl.cloudcoffee.catalog_service.dto.CampusResponse;
import cl.cloudcoffee.catalog_service.dto.CategoryResponse;
import cl.cloudcoffee.catalog_service.model.entity.Cafeteria;
import cl.cloudcoffee.catalog_service.model.entity.Campus;
import cl.cloudcoffee.catalog_service.model.entity.Category;
import cl.cloudcoffee.catalog_service.repository.CampusRepository;
import cl.cloudcoffee.catalog_service.repository.CategoryRepository;

@ExtendWith(MockitoExtension.class)
class PublicCatalogQueryServiceTest {

    @Mock
    private CampusRepository campusRepository;

    @Mock
    private CategoryRepository categoryRepository;

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
}
