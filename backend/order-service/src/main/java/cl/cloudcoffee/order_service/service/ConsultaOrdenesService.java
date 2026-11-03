package cl.cloudcoffee.order_service.service;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.order_service.dto.OrdenResponse;
import cl.cloudcoffee.order_service.dto.PaginaOrdenesResponse;
import cl.cloudcoffee.order_service.model.EstadoOrden;
import cl.cloudcoffee.order_service.model.Orden;
import cl.cloudcoffee.order_service.repository.OrdenRepository;
import cl.cloudcoffee.security.AsignacionNoVerificableException;
import cl.cloudcoffee.security.AsignacionesCafeteria;
import java.net.URI;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
public class ConsultaOrdenesService {
    private final OrdenRepository ordenes;
    private final AsignacionesCafeteria asignaciones;

    public ConsultaOrdenesService(OrdenRepository ordenes, AsignacionesCafeteria asignaciones) {
        this.ordenes = ordenes;
        this.asignaciones = asignaciones;
    }

    public PaginaOrdenesResponse listar(UUID cajeroId, int page, int size, String estado, String codigoOrden) {
        UUID cafeteriaId = cafeteriaAsignada(cajeroId);
        if (page < 0 || size < 1 || size > 100) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/paginacion-invalida"),
                    "Paginación inválida", "page debe ser mayor o igual a 0 y size debe estar entre 1 y 100.",
                    "PAGINACION_INVALIDA");
        }
        String estadoPersistido = estado == null ? null : Arrays.stream(EstadoOrden.values())
                .filter(valor -> valor.codigo().equals(estado)).findFirst().map(Enum::name)
                .orElseThrow(() -> new BusinessException(HttpStatus.BAD_REQUEST,
                        URI.create("/problems/estado-invalido"), "Estado inválido",
                        "estado debe ser un estado de orden en snake_case.", "ESTADO_INVALIDO"));
        String codigo = codigoOrden == null ? null : codigoOrden.strip();
        if (codigo != null && (codigo.isEmpty() || codigo.length() > 64)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/codigo-orden-invalido"),
                    "Código de orden inválido", "codigoOrden debe tener entre 1 y 64 caracteres.",
                    "CODIGO_ORDEN_INVALIDO");
        }

        var pageable = PageRequest.of(page, size);
        long total = ordenes.countDeCafeteria(cafeteriaId, estadoPersistido, codigo);
        List<Orden> contenido = pageable.getOffset() >= total ? List.of()
                : ordenes.findPaginaDeCafeteria(cafeteriaId, estadoPersistido, codigo, size, pageable.getOffset());
        var pagina = new PageImpl<>(contenido, pageable, total);
        // Paginar antes de cargar ítems evita duplicados, páginas truncadas y N+1.
        List<OrdenResponse> respuestas = contenido.isEmpty() ? List.of()
                : ordenes.findConItemsByIdsAndCafeteria(contenido.stream().map(Orden::getId).toList(), cafeteriaId)
                        .stream().map(OrdenResponse::from).toList();
        return PaginaOrdenesResponse.from(pagina, respuestas);
    }

    private UUID cafeteriaAsignada(UUID cajeroId) {
        try {
            return asignaciones.cafeteriaDe(cajeroId).orElseThrow(ConsultaOrdenesService::sinAsignacion);
        } catch (AsignacionNoVerificableException exception) {
            throw sinAsignacion();
        }
    }

    private static BusinessException sinAsignacion() {
        return new BusinessException(HttpStatus.FORBIDDEN, URI.create("/problems/asignacion-no-autorizada"),
                "Asignación no autorizada", "No se pudo verificar una cafetería asignada al cajero.",
                "ASIGNACION_NO_AUTORIZADA");
    }
}
