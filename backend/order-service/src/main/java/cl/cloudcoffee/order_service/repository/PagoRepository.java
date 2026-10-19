package cl.cloudcoffee.order_service.repository;

import cl.cloudcoffee.order_service.model.Pago;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface PagoRepository extends JpaRepository<Pago, UUID> {

    boolean existsByCompraId(UUID compraId);

    /** Una compra tiene como máximo un pago (UNIQUE compra_id). */
    Optional<Pago> findByCompraId(UUID compraId);
}
