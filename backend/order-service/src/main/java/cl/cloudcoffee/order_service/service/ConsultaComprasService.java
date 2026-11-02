package cl.cloudcoffee.order_service.service;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.order_service.dto.*;
import cl.cloudcoffee.order_service.model.Compra;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.order_service.repository.OrdenRepository;
import cl.cloudcoffee.order_service.repository.PagoRepository;
import java.net.URI;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.PageImpl;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
// Compra, órdenes, pago y conteo deben pertenecer al mismo snapshot de lectura.
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
public class ConsultaComprasService {
    private final CompraRepository compras;
    private final OrdenRepository ordenes;
    private final PagoRepository pagos;

    public ConsultaComprasService(CompraRepository compras, OrdenRepository ordenes, PagoRepository pagos) {
        this.compras = compras;
        this.ordenes = ordenes;
        this.pagos = pagos;
    }

    public PaginaComprasResponse historial(UUID clienteId, int page, int size) {
        if (page < 0 || size < 1 || size > 100) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/paginacion-invalida"),
                    "Paginación inválida", "page debe ser mayor o igual a 0 y size debe estar entre 1 y 100.",
                    "PAGINACION_INVALIDA");
        }
        var pageable = PageRequest.of(page, size);
        long total = compras.countByUsuarioId(clienteId);
        List<Compra> contenido = pageable.getOffset() >= total ? List.of()
                : compras.findHistorial(clienteId, size, pageable.getOffset());
        var pagina = new PageImpl<>(contenido, pageable, total);
        return PaginaComprasResponse.from(pagina, completar(clienteId, pagina.getContent()));
    }

    public CompraResponse compra(UUID clienteId, UUID compraId) {
        Compra compra = compras.findByIdAndUsuarioId(compraId, clienteId)
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND,
                        URI.create("/problems/compra-no-encontrada"), "Compra no encontrada",
                        "No existe una compra con el identificador indicado.", "COMPRA_NO_ENCONTRADA"));
        return completar(clienteId, List.of(compra)).getFirst();
    }

    public OrdenResponse orden(UUID clienteId, UUID ordenId) {
        return ordenes.findConItemsByIdAndPropietario(ordenId, clienteId).map(OrdenResponse::from)
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND,
                        URI.create("/problems/orden-no-encontrada"), "Orden no encontrada",
                        "No existe una orden con el identificador indicado.", "ORDEN_NO_ENCONTRADA"));
    }

    private List<CompraResponse> completar(UUID clienteId, List<Compra> comprasPagina) {
        if (comprasPagina.isEmpty()) return List.of();
        List<UUID> ids = comprasPagina.stream().map(Compra::getId).toList();
        var ordenesPorCompra = new HashMap<UUID, List<OrdenResponse>>();
        for (var orden : ordenes.findConItemsByComprasDelPropietario(ids, clienteId)) {
            ordenesPorCompra.computeIfAbsent(orden.getCompra().getId(), ignored -> new ArrayList<>())
                    .add(OrdenResponse.from(orden));
        }
        var pagosPorCompra = new HashMap<UUID, PagoResponse>();
        for (var pago : pagos.findByComprasDelPropietario(ids, clienteId)) {
            pagosPorCompra.put(pago.getCompra().getId(), PagoResponse.from(pago));
        }
        // Las compras anteriores a V4 no tienen snapshots: se conserva ordenes: [].
        return comprasPagina.stream().map(compra -> CompraResponse.from(compra,
                ordenesPorCompra.getOrDefault(compra.getId(), List.of()), pagosPorCompra.get(compra.getId())))
                .toList();
    }
}
