package cl.cloudcoffee.order_service.controller;

import cl.cloudcoffee.order_service.repository.OrdenRepository;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Public ranking by units in paid orders, resolved against the current catalog by the web. */
@RestController
public class ProductosPopularesController {
    private final OrdenRepository ordenes;
    public ProductosPopularesController(OrdenRepository ordenes) { this.ordenes = ordenes; }
    public record ProductoPopularResponse(UUID productoId, long cantidad) {}

    @GetMapping("/orders/productos-populares")
    public ResponseEntity<List<ProductoPopularResponse>> populares() {
        var productos = ordenes.findProductosPopulares(PageRequest.of(0, 8)).stream()
                .map(item -> new ProductoPopularResponse(item.getProductoId(), item.getCantidad())).toList();
        return ResponseEntity.ok().cacheControl(CacheControl.maxAge(Duration.ofMinutes(1)).cachePublic())
                .body(productos);
    }
}
