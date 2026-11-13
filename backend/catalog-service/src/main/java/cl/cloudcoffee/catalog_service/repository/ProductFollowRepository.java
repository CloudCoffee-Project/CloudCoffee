package cl.cloudcoffee.catalog_service.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import cl.cloudcoffee.catalog_service.model.entity.ProductFollow;
import jakarta.persistence.LockModeType;

public interface ProductFollowRepository extends JpaRepository<ProductFollow, UUID> {

    // Serializa altas y reactivaciones del mismo seguimiento; la unicidad cubre la carrera de dos inserciones.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
        SELECT f FROM ProductFollow f
        WHERE f.userId = :userId AND f.product.id = :productId AND f.cafeteriaKey = :cafeteriaKey
    """)
    Optional<ProductFollow> findForUpdate(@Param("userId") UUID userId, @Param("productId") UUID productId,
            @Param("cafeteriaKey") UUID cafeteriaKey);

    @Query("""
        SELECT f FROM ProductFollow f
        WHERE f.userId = :userId AND f.product.id = :productId AND f.cafeteriaKey = :cafeteriaKey
    """)
    Optional<ProductFollow> findByClave(@Param("userId") UUID userId, @Param("productId") UUID productId,
            @Param("cafeteriaKey") UUID cafeteriaKey);

    @Query(value = """
        SELECT f FROM ProductFollow f
        JOIN FETCH f.product
        LEFT JOIN FETCH f.cafeteria
        WHERE f.userId = :userId AND f.deletedAt IS NULL
        ORDER BY f.createdAt DESC, f.id DESC
    """, countQuery = """
        SELECT COUNT(f) FROM ProductFollow f WHERE f.userId = :userId AND f.deletedAt IS NULL
    """)
    Page<ProductFollow> findActivosDe(@Param("userId") UUID userId, Pageable pageable);

    Optional<ProductFollow> findByIdAndUserId(UUID id, UUID userId);
}
