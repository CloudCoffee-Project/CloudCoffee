package cl.cloudcoffee.order_service.repository;

import cl.cloudcoffee.order_service.model.EstadoPago;
import cl.cloudcoffee.order_service.model.Pago;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface PagoRepository extends JpaRepository<Pago, UUID> {

    boolean existsByCompraIdAndEstadoIn(UUID compraId, Collection<EstadoPago> estados);

    List<Pago> findByCompraIdOrderByCreatedAtAsc(UUID compraId);

    Optional<Pago> findFirstByCompraIdAndEstado(UUID compraId, EstadoPago estado);

    Optional<Pago> findFirstByCompraIdOrderByCreatedAtDesc(UUID compraId);
}
