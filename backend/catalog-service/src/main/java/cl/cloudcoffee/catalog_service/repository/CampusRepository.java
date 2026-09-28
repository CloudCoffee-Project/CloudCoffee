package cl.cloudcoffee.catalog_service.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import cl.cloudcoffee.catalog_service.model.entity.Campus;

public interface CampusRepository extends JpaRepository<Campus, UUID> {

    @Query("""
            select distinct campus
            from Campus campus
            left join fetch campus.cafeterias
            order by campus.name
            """)
    List<Campus> findAllWithCafeteriasOrderByName();
}
