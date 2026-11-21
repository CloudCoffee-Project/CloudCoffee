package cl.cloudcoffee.catalog_service.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;

import cl.cloudcoffee.catalog_service.model.entity.Campus;

public interface CampusRepository extends JpaRepository<Campus, UUID> {

    @Query("""
            select distinct campus
            from Campus campus
            left join fetch campus.cafeterias cafeteria
            where campus.active = true
              and (cafeteria is null or cafeteria.active = true)
            order by campus.name
            """)
    List<Campus> findAllWithCafeteriasOrderByName();

    @Query("""
            select campus from Campus campus
            where (:activo is null or campus.active = :activo)
            order by campus.name asc, campus.id asc
            """)
    Page<Campus> findAdmin(Boolean activo, Pageable pageable);

    boolean existsByNameIgnoreCase(String name);
}
