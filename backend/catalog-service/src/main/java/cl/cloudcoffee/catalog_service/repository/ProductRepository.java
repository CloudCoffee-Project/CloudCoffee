package cl.cloudcoffee.catalog_service.repository;
import cl.cloudcoffee.catalog_service.model.entity.*;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.Optional;
import java.util.UUID;

import cl.cloudcoffee.catalog_service.model.enums.ProductStatus;

public interface ProductRepository extends JpaRepository<Product, UUID> {

    @Query("""
        SELECT p FROM Product p
        JOIN FETCH p.category
        WHERE p.id = :productId
          AND p.status = :status
          AND p.category.active = true
    """)
    Optional<Product> findByIdAndStatusWithCategory(
            @Param("productId") UUID productId,
            @Param("status") ProductStatus status
    );
    
    @Query("""
        SELECT DISTINCT p FROM Product p
        JOIN Offer o ON o.product = p
        JOIN o.cafeteria c
        WHERE c.campus.id = :campusId
          AND c.campus.active = true
          AND c.active = true
          AND c.status = cl.cloudcoffee.catalog_service.model.enums.CafeteriaStatus.OPEN
          AND o.status = cl.cloudcoffee.catalog_service.model.enums.OfferStatus.AVAILABLE
          AND p.status = cl.cloudcoffee.catalog_service.model.enums.ProductStatus.ACTIVE
          AND p.category.active = true
          AND (:categoryId IS NULL OR p.category.id = :categoryId)
          AND (:q IS NULL OR :q = '' OR LOWER(p.name) LIKE LOWER(CONCAT('%', :q, '%')) OR LOWER(p.description) LIKE LOWER(CONCAT('%', :q, '%')))
    """)
    Page<Product> findAvailableProducts(
            @Param("campusId") UUID campusId,
            @Param("categoryId") UUID categoryId,
            @Param("q") String q,
            Pageable pageable
    );

    long countByCategoryIdAndStatus(UUID categoryId, ProductStatus status);

    boolean existsByNameIgnoreCase(String name);

    boolean existsByNameIgnoreCaseAndIdNot(String name, UUID id);

    @Query("""
            SELECT p FROM Product p
            WHERE (:categoriaId IS NULL OR p.category.id = :categoriaId)
              AND (:activo IS NULL OR p.status = :status)
              AND (:q IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT('%', :q, '%'))
                   OR LOWER(COALESCE(p.description, '')) LIKE LOWER(CONCAT('%', :q, '%')))
            ORDER BY p.name ASC, p.id ASC
            """)
    Page<Product> findAdmin(@Param("categoriaId") UUID categoriaId, @Param("activo") Boolean activo,
            @Param("status") ProductStatus status, @Param("q") String q, Pageable pageable);
}
