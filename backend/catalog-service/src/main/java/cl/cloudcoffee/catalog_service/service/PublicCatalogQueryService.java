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
    private final cl.cloudcoffee.catalog_service.repository.ProductRepository productRepository;
    private final cl.cloudcoffee.catalog_service.repository.OfferRepository offerRepository;

    public PublicCatalogQueryService(
            CampusRepository campusRepository,
            CategoryRepository categoryRepository,
            cl.cloudcoffee.catalog_service.repository.ProductRepository productRepository,
            cl.cloudcoffee.catalog_service.repository.OfferRepository offerRepository
    ) {
        this.campusRepository = campusRepository;
        this.categoryRepository = categoryRepository;
        this.productRepository = productRepository;
        this.offerRepository = offerRepository;
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

    public org.springframework.data.domain.Page<cl.cloudcoffee.catalog_service.dto.ProductResponse> findProducts(
            java.util.UUID campusId,
            java.util.UUID categoryId,
            String q,
            org.springframework.data.domain.Pageable pageable
    ) {
        return productRepository.findAvailableProducts(campusId, categoryId, q, pageable)
                .map(cl.cloudcoffee.catalog_service.dto.ProductResponse::from);
    }

    public List<cl.cloudcoffee.catalog_service.dto.ProductOfferResponse> findProductOffers(java.util.UUID productId, java.util.UUID campusId) {
        return offerRepository.findOffersByProductAndCampus(productId, campusId).stream()
                .map(cl.cloudcoffee.catalog_service.dto.ProductOfferResponse::from)
                .toList();
    }
}
