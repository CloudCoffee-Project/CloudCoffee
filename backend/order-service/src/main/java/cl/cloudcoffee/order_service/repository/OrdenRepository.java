package cl.cloudcoffee.order_service.repository;

import cl.cloudcoffee.order_service.dto.VentaResponse;
import cl.cloudcoffee.order_service.model.EstadoOrden;
import cl.cloudcoffee.order_service.model.Orden;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface OrdenRepository extends JpaRepository<Orden, UUID> {
    String FILTRO_VENTAS = """
            from Orden o where o.cafeteriaId = :cafeteriaId and o.estado in :estados
            and o.pagadoAt >= :inicio and o.pagadoAt < :fin
            """;

    @Query("select count(o) " + FILTRO_VENTAS)
    long countVentas(UUID cafeteriaId, Collection<EstadoOrden> estados, Instant inicio, Instant fin);

    @Query("""
            select new cl.cloudcoffee.order_service.dto.VentaResponse(
                o.id, o.compra.id, o.codigoOrden, o.cafeteriaId, o.cafeteriaNombre, o.campusId,
                o.estado, o.montoTotal, o.moneda, size(o.items), o.pagadoAt, o.entregadoAt)
            """ + FILTRO_VENTAS + " order by o.pagadoAt desc, o.id desc")
    List<VentaResponse> findVentas(UUID cafeteriaId, Collection<EstadoOrden> estados, Instant inicio,
            Instant fin, Pageable pageable);

    @Query("select o.estado as estado, count(o) as ordenes, sum(o.montoTotal) as montoTotal "
            + FILTRO_VENTAS + " group by o.estado order by o.estado")
    List<TotalPorEstado> totalizarVentas(UUID cafeteriaId, Collection<EstadoOrden> estados, Instant inicio, Instant fin);

    @Query("""
            select distinct o from Orden o join fetch o.compra left join fetch o.items
            where o.id = :id and o.cafeteriaId = :cafeteriaId
            and o.pagadoAt is not null and o.estado in :estados
            """)
    Optional<Orden> findVentaConItems(UUID id, UUID cafeteriaId, Collection<EstadoOrden> estados);

    interface TotalPorEstado {
        EstadoOrden getEstado();
        long getOrdenes();
        BigDecimal getMontoTotal();
    }

    interface ProductoPopular {
        UUID getProductoId();
        long getCantidad();
    }

    // Global aggregate only: no customer, purchase or cafeteria identifiers are public.
    @Query("""
            select i.productoId as productoId, sum(i.cantidad) as cantidad
            from Orden o join o.items i
            where o.estado in (
                cl.cloudcoffee.order_service.model.EstadoOrden.PAGADO,
                cl.cloudcoffee.order_service.model.EstadoOrden.LISTO_PARA_RETIRO,
                cl.cloudcoffee.order_service.model.EstadoOrden.ENTREGADO,
                cl.cloudcoffee.order_service.model.EstadoOrden.NO_RETIRADO_PENDIENTE_REVISION,
                cl.cloudcoffee.order_service.model.EstadoOrden.NO_RETIRADO_FINAL)
            group by i.productoId
            order by sum(i.cantidad) desc, i.productoId asc
            """)
    List<ProductoPopular> findProductosPopulares(Pageable pageable);

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
