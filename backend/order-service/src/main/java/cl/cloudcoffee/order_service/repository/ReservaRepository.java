package cl.cloudcoffee.order_service.repository;

import cl.cloudcoffee.order_service.model.EstadoReserva;
import cl.cloudcoffee.order_service.model.Reserva;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface ReservaRepository extends JpaRepository<Reserva, UUID> {

    List<Reserva> findByCompraIdAndEstado(UUID compraId, EstadoReserva estado);

    List<Reserva> findByCompraIdOrderByCreatedAtAsc(UUID compraId);

    @Query("""
            select distinct r.compra.id from Reserva r
            where r.estado = cl.cloudcoffee.order_service.model.EstadoReserva.ACTIVA
              and r.venceEn <= :ahora
            """)
    List<UUID> findComprasConReservasVencidas(@Param("ahora") Instant ahora);
}
