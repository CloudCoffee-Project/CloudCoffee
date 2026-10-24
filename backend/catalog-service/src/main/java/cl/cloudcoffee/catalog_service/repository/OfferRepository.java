package cl.cloudcoffee.catalog_service.repository;
import cl.cloudcoffee.catalog_service.model.entity.*;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;

public interface OfferRepository extends JpaRepository<Offer, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT o FROM Offer o WHERE o.id = :offerId")
    java.util.Optional<Offer> findByIdForUpdate(@Param("offerId") UUID offerId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
        UPDATE offer
        SET stock = stock - :quantity,
            version = version + 1,
            status = CASE WHEN stock - :quantity = 0 THEN 'OUT_OF_STOCK' ELSE status END
        WHERE id = :offerId
          AND status = 'AVAILABLE'
          AND stock >= :quantity
          AND EXISTS (
              SELECT 1
              FROM product p
              JOIN cafeteria c ON c.id = offer.cafeteria_id
              WHERE p.id = offer.product_id
                AND p.status = 'ACTIVE'
                AND c.status = 'OPEN'
          )
        """, nativeQuery = true)
    int reserveStock(@Param("offerId") UUID offerId, @Param("quantity") int quantity);

    @Query("""
        SELECT o FROM Offer o
        JOIN FETCH o.cafeteria c
        WHERE o.product.id = :productId
          AND c.campus.id = :campusId
          AND c.status = cl.cloudcoffee.catalog_service.model.enums.CafeteriaStatus.OPEN
          AND o.status = cl.cloudcoffee.catalog_service.model.enums.OfferStatus.AVAILABLE
        ORDER BY o.price ASC
    """)
    List<Offer> findOffersByProductAndCampus(
            @Param("productId") UUID productId,
            @Param("campusId") UUID campusId
    );

    // INT2-65: inventario completo de una cafetería, sin filtrar por estado.
    @Query("""
        SELECT o FROM Offer o
        JOIN FETCH o.product p
        WHERE o.cafeteria.id = :cafeteriaId
        ORDER BY p.name ASC
    """)
    List<Offer> findInventoryByCafeteria(@Param("cafeteriaId") UUID cafeteriaId);
}
