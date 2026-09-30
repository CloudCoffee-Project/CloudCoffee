package cl.cloudcoffee.catalog_service.repository;
import cl.cloudcoffee.catalog_service.model.entity.*;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;

public interface OfferRepository extends JpaRepository<Offer, UUID> {

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
}
