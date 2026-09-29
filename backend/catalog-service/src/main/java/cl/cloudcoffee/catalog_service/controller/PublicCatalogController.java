package cl.cloudcoffee.catalog_service.controller;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import cl.cloudcoffee.catalog_service.dto.CampusResponse;
import cl.cloudcoffee.catalog_service.dto.CategoryResponse;
import cl.cloudcoffee.catalog_service.service.PublicCatalogQueryService;

@RestController
@RequestMapping("/catalog")
public class PublicCatalogController {

    private final PublicCatalogQueryService queryService;

    public PublicCatalogController(PublicCatalogQueryService queryService) {
        this.queryService = queryService;
    }

    @GetMapping("/campus")
    public List<CampusResponse> findAllCampus() {
        return queryService.findAllCampus();
    }

    @GetMapping("/categorias")
    public List<CategoryResponse> findAllCategories() {
        return queryService.findAllCategories();
    }

    @GetMapping("/productos")
    public org.springframework.data.domain.Page<cl.cloudcoffee.catalog_service.dto.ProductResponse> findProducts(
            @org.springframework.web.bind.annotation.RequestParam java.util.UUID campusId,
            @org.springframework.web.bind.annotation.RequestParam(required = false) java.util.UUID categoriaId,
            @org.springframework.web.bind.annotation.RequestParam(required = false) String q,
            org.springframework.data.domain.Pageable pageable
    ) {
        return queryService.findProducts(campusId, categoriaId, q, pageable);
    }
}
