package cl.cloudcoffee.order_service.service;

import static cl.cloudcoffee.order_service.model.EstadoOrden.*;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.order_service.dto.PaginaVentasResponse;
import cl.cloudcoffee.order_service.dto.ResumenVentasResponse;
import cl.cloudcoffee.order_service.dto.VentaDetalleResponse;
import cl.cloudcoffee.order_service.dto.VentaResponse;
import cl.cloudcoffee.order_service.model.EstadoOrden;
import cl.cloudcoffee.order_service.repository.OrdenRepository;
import cl.cloudcoffee.security.AsignacionNoVerificableException;
import cl.cloudcoffee.security.AsignacionesCafeteria;
import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
public class ConsultaVentasService {
    private static final ZoneId ZONA_VENTAS = ZoneId.of("America/Santiago");
    private static final Set<EstadoOrden> ESTADOS_VENTA = Set.of(PAGADO, LISTO_PARA_RETIRO, ENTREGADO,
            NO_RETIRADO_PENDIENTE_REVISION, NO_RETIRADO_FINAL);
    private final OrdenRepository ordenes;
    private final AsignacionesCafeteria asignaciones;
    private final Clock clock;

    public ConsultaVentasService(OrdenRepository ordenes, AsignacionesCafeteria asignaciones, Clock clock) {
        this.ordenes = ordenes;
        this.asignaciones = asignaciones;
        this.clock = clock;
    }

    public PaginaVentasResponse listar(UUID adminId, UUID cafeteriaSolicitada, LocalDate desde, LocalDate hasta,
            String estado, int page, int size) {
        UUID cafeteriaId = cafeteriaAsignada(adminId, cafeteriaSolicitada);
        var rango = rangoVentas(desde, hasta);
        var estados = estadosDeVenta(estado);
        if (page < 0 || size < 1 || size > 100) {
            throw problema(HttpStatus.BAD_REQUEST, "paginacion-invalida", "Paginación inválida",
                    "page debe ser mayor o igual a 0 y size debe estar entre 1 y 100.", "PAGINACION_INVALIDA");
        }
        var pageable = PageRequest.of(page, size);
        long total = ordenes.countVentas(cafeteriaId, estados, rango.inicio(), rango.fin());
        List<VentaResponse> contenido = pageable.getOffset() >= total ? List.of()
                : ordenes.findVentas(cafeteriaId, estados, rango.inicio(), rango.fin(), pageable);
        return PaginaVentasResponse.from(new PageImpl<>(contenido, pageable, total));
    }

    public ResumenVentasResponse resumen(UUID adminId, UUID cafeteriaSolicitada, LocalDate desde, LocalDate hasta,
            String estado) {
        UUID cafeteriaId = cafeteriaAsignada(adminId, cafeteriaSolicitada);
        var rango = rangoVentas(desde, hasta);
        var estados = estadosDeVenta(estado);
        var porEstado = ordenes.totalizarVentas(cafeteriaId, estados, rango.inicio(), rango.fin()).stream()
                .map(total -> new ResumenVentasResponse.PorEstado(total.getEstado().codigo(), total.getOrdenes(),
                        total.getMontoTotal().longValueExact()))
                .toList();
        long cantidad = porEstado.stream().mapToLong(ResumenVentasResponse.PorEstado::ordenes).sum();
        long monto = porEstado.stream().mapToLong(ResumenVentasResponse.PorEstado::montoTotal).sum();
        var porCafeteria = cantidad == 0 ? List.<ResumenVentasResponse.PorCafeteria>of()
                : List.of(new ResumenVentasResponse.PorCafeteria(cafeteriaId,
                        ordenes.findVentas(cafeteriaId, estados, rango.inicio(), rango.fin(), PageRequest.of(0, 1))
                                .getFirst().cafeteriaNombre(), cantidad, monto));
        return new ResumenVentasResponse(rango.desde(), rango.hasta(), "CLP", cantidad, monto, porEstado, porCafeteria);
    }

    public VentaDetalleResponse detalle(UUID adminId, UUID ordenId) {
        UUID cafeteriaId = cafeteriaAsignada(adminId, null);
        return ordenes.findVentaConItems(ordenId, cafeteriaId, ESTADOS_VENTA).map(VentaDetalleResponse::from)
                .orElseThrow(() -> problema(HttpStatus.NOT_FOUND, "orden-no-encontrada", "Orden no encontrada",
                        "No existe una venta con ese identificador en la cafetería asignada.", "ORDEN_NO_ENCONTRADA"));
    }

    private UUID cafeteriaAsignada(UUID adminId, UUID cafeteriaSolicitada) {
        try {
            return asignaciones.cafeteriaDe(adminId)
                    .filter(cafeteriaId -> cafeteriaSolicitada == null || cafeteriaId.equals(cafeteriaSolicitada))
                    .orElseThrow(ConsultaVentasService::sinAsignacion);
        } catch (AsignacionNoVerificableException exception) {
            throw sinAsignacion();
        }
    }

    private Rango rangoVentas(LocalDate desde, LocalDate hasta) {
        LocalDate ultimoDia = hasta == null ? LocalDate.now(clock.withZone(ZONA_VENTAS)) : hasta;
        if (ultimoDia.getYear() < 1 || ultimoDia.getYear() > 9999) {
            throw rangoInvalido();
        }
        LocalDate primerDia = desde == null ? ultimoDia.minusDays(29) : desde;
        long dias = ChronoUnit.DAYS.between(primerDia, ultimoDia);
        if (dias < 0 || dias >= 92 || primerDia.getYear() < 1) {
            throw rangoInvalido();
        }
        return new Rango(primerDia, ultimoDia, primerDia.atStartOfDay(ZONA_VENTAS).toInstant(),
                ultimoDia.plusDays(1).atStartOfDay(ZONA_VENTAS).toInstant());
    }

    private static Set<EstadoOrden> estadosDeVenta(String estado) {
        if (estado == null) {
            return ESTADOS_VENTA;
        }
        return ESTADOS_VENTA.stream().filter(valor -> valor.codigo().equals(estado)).findFirst().map(Set::of)
                .orElseThrow(() -> problema(HttpStatus.BAD_REQUEST, "estado-invalido", "Estado inválido",
                        "El filtro debe indicar un estado de venta.", "ESTADO_INVALIDO"));
    }

    private static BusinessException rangoInvalido() {
        return problema(HttpStatus.BAD_REQUEST, "rango-ventas-invalido", "Rango de ventas inválido",
                "El rango debe tener entre 1 y 92 días inclusivos en America/Santiago.", "RANGO_VENTAS_INVALIDO");
    }

    private static BusinessException sinAsignacion() {
        return problema(HttpStatus.FORBIDDEN, "asignacion-no-autorizada", "Asignación no autorizada",
                "La consulta requiere una cafetería asignada y verificable.", "ASIGNACION_NO_AUTORIZADA");
    }

    private static BusinessException problema(HttpStatus status, String slug, String titulo, String detalle,
            String codigo) {
        return new BusinessException(status, URI.create("/problems/" + slug), titulo, detalle, codigo);
    }

    private record Rango(LocalDate desde, LocalDate hasta, Instant inicio, Instant fin) {}
}
