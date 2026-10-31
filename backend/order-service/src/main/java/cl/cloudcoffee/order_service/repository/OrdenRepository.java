package cl.cloudcoffee.order_service.repository;

import cl.cloudcoffee.order_service.model.Orden;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrdenRepository extends JpaRepository<Orden, UUID> {}
