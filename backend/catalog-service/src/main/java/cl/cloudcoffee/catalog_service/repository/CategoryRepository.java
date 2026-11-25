package cl.cloudcoffee.catalog_service.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import cl.cloudcoffee.catalog_service.model.entity.Category;

public interface CategoryRepository extends JpaRepository<Category, UUID> {

    List<Category> findAllByActiveTrueOrderByNameAsc();

    boolean existsByNameIgnoreCase(String name);

    boolean existsByNameIgnoreCaseAndIdNot(String name, UUID id);

    @Query("""
            SELECT c FROM Category c
            WHERE (:activo IS NULL OR c.active = :activo)
            ORDER BY c.name ASC, c.id ASC
            """)
    Page<Category> findAdmin(@Param("activo") Boolean activo, Pageable pageable);
}
