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
    // CAST tipa los filtros nulos también en PostgreSQL.
    @Query(value = """
            select count(*) from ordenes
            where cafeteria_id = :cafeteriaId
                and (cast(:estado as varchar) is null or estado = cast(:estado as varchar))
                and (cast(:codigo as varchar) is null or codigo_orden = cast(:codigo as varchar))
            """, nativeQuery = true)
    long countDeCafeteria(@Param("cafeteriaId") UUID cafeteriaId, @Param("estado") String estado,
            @Param("codigo") String codigo);

    // OFFSET long, como el historial de compras; nunca se pagina un JOIN FETCH de ítems.
    @Query(value = """
            select * from ordenes
            where cafeteria_id = :cafeteriaId
                and (cast(:estado as varchar) is null or estado = cast(:estado as varchar))
                and (cast(:codigo as varchar) is null or codigo_orden = cast(:codigo as varchar))
            order by created_at desc, id desc limit :size offset :offset
            """, nativeQuery = true)
    List<Orden> findPaginaDeCafeteria(@Param("cafeteriaId") UUID cafeteriaId, @Param("estado") String estado,
            @Param("codigo") String codigo, @Param("size") int size, @Param("offset") long offset);

    @Query("""
            select distinct o from Orden o join fetch o.compra left join fetch o.items
            where o.id in :ids and o.cafeteriaId = :cafeteriaId
            order by o.createdAt desc, o.id desc
            """)
    List<Orden> findConItemsByIdsAndCafeteria(@Param("ids") Collection<UUID> ids,
            @Param("cafeteriaId") UUID cafeteriaId);

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
