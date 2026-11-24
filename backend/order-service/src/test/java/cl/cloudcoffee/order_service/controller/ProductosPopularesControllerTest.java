package cl.cloudcoffee.order_service.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import cl.cloudcoffee.order_service.model.*;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest(properties = "management.tracing.enabled=false")
@AutoConfigureMockMvc
@Transactional
class ProductosPopularesControllerTest extends JwtTestSupport {
    @Autowired MockMvc mvc;
    @Autowired CompraRepository compras;
    @Autowired JdbcTemplate jdbc;

    @Test void rankingPublicoSumaUnidadesPagadasYNoExponeDatosDeCompras() throws Exception {
        // Tests are rolled back; isolate ranking from seeded or other test purchases.
        jdbc.update("update ordenes set estado = 'CANCELADO'");
        UUID primero = UUID.fromString("00000000-0000-4000-8000-000000000001");
        UUID segundo = UUID.fromString("00000000-0000-4000-8000-000000000002");
        agregar(primero, 2, "PAGADO"); agregar(primero, 3, "ENTREGADO");
        agregar(segundo, 4, "LISTO_PARA_RETIRO");
        agregar(segundo, 100, "CANCELADO"); agregar(segundo, 100, "PENDIENTE_PAGO");
        mvc.perform(get("/orders/productos-populares"))
            .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "max-age=60, public"))
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].productoId").value(primero.toString()))
            .andExpect(jsonPath("$[0].cantidad").value(5))
            .andExpect(jsonPath("$[1].cantidad").value(4))
            .andExpect(jsonPath("$[0].length()").value(2));
        mvc.perform(get("/compras")).andExpect(status().isUnauthorized());
    }
    @Test void rankingVacioYDesempateEstables() throws Exception {
        jdbc.update("update ordenes set estado = 'CANCELADO'");
        mvc.perform(get("/orders/productos-populares")).andExpect(status().isOk()).andExpect(content().json("[]"));
        for (int i = 10; i > 0; i--) agregar(new UUID(0, i), 1, "PAGADO");
        mvc.perform(get("/orders/productos-populares"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(8))
            .andExpect(jsonPath("$[0].productoId").value(new UUID(0, 1).toString()));
    }
    private void agregar(UUID producto, int cantidad, String estado) {
        var item = new OrdenItem(UUID.randomUUID(), producto, "Café", cantidad, BigDecimal.valueOf(1000));
        var orden = new Orden("CC-" + UUID.randomUUID(), UUID.randomUUID(), "Central", EstadoOrden.PENDIENTE_PAGO, List.of(item));
        compras.saveAndFlush(new Compra(UUID.randomUUID(), Instant.now(), List.of(orden)));
        jdbc.update("update ordenes set estado = ? where id = ?", estado, orden.getId());
    }
}
