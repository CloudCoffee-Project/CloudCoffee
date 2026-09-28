package cl.cloudcoffee.catalog_service.service;

import java.util.List;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.catalog_service.dto.CampusResponse;
import cl.cloudcoffee.catalog_service.dto.CategoryResponse;
import cl.cloudcoffee.catalog_service.repository.CampusRepository;
import cl.cloudcoffee.catalog_service.repository.CategoryRepository;

@Service
@Transactional(readOnly = true)
public class PublicCatalogQueryService {

    private final CampusRepository campusRepository;
    private final CategoryRepository categoryRepository;

    public PublicCatalogQueryService(
            CampusRepository campusRepository,
            CategoryRepository categoryRepository
    ) {
        this.campusRepository = campusRepository;
        this.categoryRepository = categoryRepository;
    }

    public List<CampusResponse> findAllCampus() {
        return campusRepository.findAllWithCafeteriasOrderByName().stream()
                .map(CampusResponse::from)
                .toList();
    }

    public List<CategoryResponse> findAllCategories() {
        return categoryRepository.findAllByOrderByNameAsc().stream()
                .map(CategoryResponse::from)
                .toList();
    }
}
