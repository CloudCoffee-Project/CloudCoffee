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

    // INT2-65: inventario completo de una cafetería, sin filtrar por estado.
    @Query("""
        SELECT o FROM Offer o
        JOIN FETCH o.product p
        WHERE o.cafeteria.id = :cafeteriaId
        ORDER BY p.name ASC
    """)
    List<Offer> findInventoryByCafeteria(@Param("cafeteriaId") UUID cafeteriaId);

    // INT2-77: serializa los descuentos de stock de una misma oferta.
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT o FROM Offer o WHERE o.id = :id")
    java.util.Optional<Offer> findForUpdate(@Param("id") UUID id);
}
