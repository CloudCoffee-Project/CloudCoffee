package cl.cloudcoffee.order_service.repository;

import cl.cloudcoffee.order_service.model.ComandoPagoSimulado;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface ComandoPagoSimuladoRepository extends JpaRepository<ComandoPagoSimulado, UUID> {

    Optional<ComandoPagoSimulado> findByCompraIdAndClave(UUID compraId, String clave);
}
