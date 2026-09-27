package cl.cloudcoffee.catalog_service.repository;
import cl.cloudcoffee.catalog_service.model.entity.*;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;

public interface CafeteriaRepository extends JpaRepository<Cafeteria, UUID> {}
