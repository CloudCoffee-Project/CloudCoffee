package cl.cloudcoffee.auth_service.repository;

import cl.cloudcoffee.auth_service.model.AsignacionCafeteria;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface AsignacionCafeteriaRepository extends JpaRepository<AsignacionCafeteria, UUID> {
}
