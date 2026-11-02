package cl.cloudcoffee.order_service.repository;

import cl.cloudcoffee.order_service.model.Compra;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;
import java.util.List;

public interface CompraRepository extends JpaRepository<Compra, UUID> {

    long countByUsuarioId(UUID usuarioId);

    // OFFSET long: JPA setFirstResult limita a int incluso si page y size son válidos.
    @Query(value = """
            select * from compras where usuario_id = :usuarioId
            order by created_at desc, id desc limit :size offset :offset
            """, nativeQuery = true)
    List<Compra> findHistorial(@Param("usuarioId") UUID usuarioId, @Param("size") int size,
            @Param("offset") long offset);

    Optional<Compra> findByIdAndUsuarioId(UUID id, UUID usuarioId);

    // Serializa los inicios de pago de una misma compra.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from Compra c where c.id = :id")
    Optional<Compra> findForUpdate(@Param("id") UUID id);
}
