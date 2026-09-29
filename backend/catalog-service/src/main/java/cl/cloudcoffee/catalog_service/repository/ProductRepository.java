package cl.cloudcoffee.catalog_service.repository;
import cl.cloudcoffee.catalog_service.model.entity.*;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProductRepository extends JpaRepository<Product, UUID> {
    
    @Query("""
        SELECT DISTINCT p FROM Product p
        JOIN Offer o ON o.product = p
        JOIN o.cafeteria c
        WHERE c.campus.id = :campusId
          AND c.status = cl.cloudcoffee.catalog_service.model.enums.CafeteriaStatus.OPEN
          AND o.status = cl.cloudcoffee.catalog_service.model.enums.OfferStatus.AVAILABLE
          AND (:categoryId IS NULL OR p.category.id = :categoryId)
          AND (:q IS NULL OR :q = '' OR LOWER(p.name) LIKE LOWER(CONCAT('%', :q, '%')) OR LOWER(p.description) LIKE LOWER(CONCAT('%', :q, '%')))
    """)
    Page<Product> findAvailableProducts(
            @Param("campusId") UUID campusId,
            @Param("categoryId") UUID categoryId,
            @Param("q") String q,
            Pageable pageable
    );
}
