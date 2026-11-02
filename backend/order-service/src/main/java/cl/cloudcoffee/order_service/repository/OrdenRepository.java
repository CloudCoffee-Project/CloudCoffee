package cl.cloudcoffee.order_service.repository;

import cl.cloudcoffee.order_service.model.Orden;
import java.util.UUID;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface OrdenRepository extends JpaRepository<Orden, UUID> {
    // La página se aplica a compras antes de cargar sus colecciones, nunca a un JOIN FETCH.
    @Query("""
            select distinct o from Orden o join fetch o.compra c left join fetch o.items
            where c.id in :compraIds and c.usuarioId = :usuarioId
            order by o.createdAt desc, o.id desc
            """)
    List<Orden> findConItemsByComprasDelPropietario(@Param("compraIds") Collection<UUID> compraIds,
            @Param("usuarioId") UUID usuarioId);

    @Query("""
            select distinct o from Orden o join fetch o.compra c left join fetch o.items
            where o.id = :id and c.usuarioId = :usuarioId
            """)
    Optional<Orden> findConItemsByIdAndPropietario(@Param("id") UUID id, @Param("usuarioId") UUID usuarioId);
}
