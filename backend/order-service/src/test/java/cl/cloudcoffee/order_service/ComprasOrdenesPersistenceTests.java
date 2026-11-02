package cl.cloudcoffee.order_service;

import static org.assertj.core.api.Assertions.*;

import cl.cloudcoffee.order_service.model.*;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.order_service.service.PagoService;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest(properties = "management.tracing.enabled=false")
@Transactional
class ComprasOrdenesPersistenceTests extends JwtTestSupport {
    @Autowired CompraRepository compras;
    @Autowired EntityManager entityManager;
    @Autowired PagoService pagos;

    @Test
    void persisteYRecargaCompraConDosCafeteriasYPreciosHistoricos() {
        UUID cliente = UUID.randomUUID();
        UUID oferta = UUID.randomUUID();
        UUID producto = UUID.randomUUID();
        var cafe = new OrdenItem(oferta, producto, "Café original", 2, new BigDecimal("1800"));
        var primera = new Orden("CC-" + UUID.randomUUID(), UUID.randomUUID(), "Central original",
                EstadoOrden.PENDIENTE_PAGO, List.of(cafe));
        var segunda = new Orden("CC-" + UUID.randomUUID(), UUID.randomUUID(), "Norte original",
                EstadoOrden.REVISION_REQUERIDA,
                List.of(new OrdenItem(UUID.randomUUID(), UUID.randomUUID(), "Té", 1, new BigDecimal("900"))));
        Instant creada = Instant.parse("2026-10-31T12:00:00Z");
        Compra guardada = compras.saveAndFlush(new Compra(cliente, creada, List.of(primera, segunda)));
        UUID id = guardada.getId();
        entityManager.clear();

        Compra compra = compras.findById(id).orElseThrow();
        assertThat(compra.getUsuarioId()).isEqualTo(cliente);
        assertThat(compra.getMontoTotal()).isEqualByComparingTo("4500");
        assertThat(compra.getEstado()).isEqualTo(EstadoCompra.REVISION_REQUERIDA);
        assertThat(compra.getReservaExpiraAt()).isEqualTo(creada.plusSeconds(900));
        assertThat(compra.getCreatedAt()).isEqualTo(creada);
        assertThat(compra.getUpdatedAt()).isEqualTo(creada);
        assertThat(compra.getOrdenes()).hasSize(2);
        Orden central = compra.getOrdenes().stream().filter(o -> o.getId().equals(primera.getId())).findFirst().orElseThrow();
        assertThat(central.getCompra()).isSameAs(compra);
        assertThat(central.getCafeteriaNombre()).isEqualTo("Central original");
        assertThat(central.getMontoTotal()).isEqualByComparingTo("3600");
        assertThat(central.getMoneda()).isEqualTo("CLP");
        assertThat(central.getRetiroHasta()).isNull();
        assertThat(central.getEntregadoAt()).isNull();
        OrdenItem item = central.getItems().getFirst();
        assertThat(item.getId()).isNotNull();
        assertThat(item.getOfertaId()).isEqualTo(oferta);
        assertThat(item.getProductoId()).isEqualTo(producto);
        assertThat(item.getProductoNombre()).isEqualTo("Café original");
        assertThat(item.getPrecioUnitario()).isEqualByComparingTo("1800");
        assertThat(item.getSubtotal()).isEqualByComparingTo("3600");
    }

    @Test
    void pagosExistentesPuedenLeerUnaCompraConOrdenesPorElTotalCalculado() {
        var orden = new Orden("CC-" + UUID.randomUUID(), UUID.randomUUID(), "Central",
                EstadoOrden.PENDIENTE_PAGO,
                List.of(new OrdenItem(UUID.randomUUID(), UUID.randomUUID(), "Café", 2, new BigDecimal("1800"))));
        Compra compra = compras.saveAndFlush(new Compra(UUID.randomUUID(), Instant.now(), List.of(orden)));

        Pago pago = pagos.iniciarPago(compra.getId());

        assertThat(pago.getCompra().getId()).isEqualTo(compra.getId());
        assertThat(pago.getMonto()).isEqualByComparingTo("3600");
        assertThat(pago.getEstado()).isEqualTo(EstadoPago.PENDIENTE);
    }
}
