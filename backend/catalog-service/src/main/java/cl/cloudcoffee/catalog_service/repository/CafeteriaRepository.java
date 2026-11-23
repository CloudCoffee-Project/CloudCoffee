package cl.cloudcoffee.catalog_service.repository;
import cl.cloudcoffee.catalog_service.model.entity.*;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CafeteriaRepository extends JpaRepository<Cafeteria, UUID> {
    @Query("""
            select cafeteria from Cafeteria cafeteria
            join fetch cafeteria.campus campus
            where (:campusId is null or campus.id = :campusId)
              and (:activo is null or cafeteria.active = :activo)
            """)
    Page<Cafeteria> findAdmin(@Param("campusId") UUID campusId,
                              @Param("activo") Boolean activo,
                              Pageable pageable);

    boolean existsByCampusIdAndNameIgnoreCase(UUID campusId, String name);
    long countByCampusIdAndActiveTrue(UUID campusId);
}
