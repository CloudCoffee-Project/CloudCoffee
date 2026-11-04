package cl.cloudcoffee.order_service.repository;

import cl.cloudcoffee.order_service.model.Pago;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PagoRepository extends JpaRepository<Pago, UUID> {

    boolean existsByCompraId(UUID compraId);

    /** Una compra tiene como máximo un pago (UNIQUE compra_id). */
    Optional<Pago> findByCompraId(UUID compraId);

    @Query("""
            select p from Pago p join fetch p.compra c
            where c.id in :compraIds and c.usuarioId = :usuarioId
            """)
    List<Pago> findByComprasDelPropietario(@Param("compraIds") Collection<UUID> compraIds,
            @Param("usuarioId") UUID usuarioId);
}
