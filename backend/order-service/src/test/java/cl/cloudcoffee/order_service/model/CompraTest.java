package cl.cloudcoffee.order_service.model;

import static org.assertj.core.api.Assertions.*;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class CompraTest {
    @Test
    void calculaTotalesPorCafeteriaYConservaSnapshotsSinDependerDeLasListasDelLlamador() {
        var items = new ArrayList<>(List.of(item("1800", 2), item("500", 1)));
        Orden primera = orden(UUID.randomUUID(), EstadoOrden.PENDIENTE_PAGO, items);
        Orden segunda = orden(UUID.randomUUID(), EstadoOrden.REVISION_REQUERIDA, List.of(item("900", 1)));
        var ordenes = new ArrayList<>(List.of(primera, segunda));
        Instant fecha = Instant.parse("2026-10-31T12:00:00Z");

        Compra compra = new Compra(UUID.randomUUID(), fecha, ordenes);
        items.clear();
        ordenes.clear();

        assertThat(compra.getMontoTotal()).isEqualByComparingTo("5000");
        assertThat(primera.getMontoTotal()).isEqualByComparingTo("4100");
        assertThat(compra.getEstado()).isEqualTo(EstadoCompra.REVISION_REQUERIDA);
        assertThat(compra.getMoneda()).isEqualTo("CLP");
        assertThat(compra.getOrdenes()).hasSize(2);
        assertThat(primera.getItems()).hasSize(2);
        assertThat(primera.getItems().getFirst().getProductoNombre()).isEqualTo("Café al reservar");
        assertThat(primera.getItems().getFirst().getSubtotal()).isEqualByComparingTo("3600");
        assertThat(compra.getReservaExpiraAt()).isEqualTo(fecha.plusSeconds(900));
        assertThat(segunda.getReservaExpiraAt()).isEqualTo(compra.getReservaExpiraAt());
        assertThatThrownBy(() -> compra.getOrdenes().clear()).isInstanceOf(UnsupportedOperationException.class);
        assertThatThrownBy(() -> primera.getItems().clear()).isInstanceOf(UnsupportedOperationException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"-1", "0.01", "2000000001"})
    void rechazaPreciosFueraDelContratoSinRedondearlos(String precio) {
        assertThatIllegalArgumentException().isThrownBy(() -> item(precio, 1));
    }

    @Test
    void validaElLimiteSobreElTotalYNoSoloSobreCadaItem() {
        assertThatIllegalArgumentException().isThrownBy(() -> item("2000000000", 2));
        assertThatIllegalArgumentException().isThrownBy(() -> new Compra(UUID.randomUUID(), Instant.now(), List.of(
                orden(UUID.randomUUID(), EstadoOrden.PENDIENTE_PAGO, List.of(item("1500000000", 1))),
                orden(UUID.randomUUID(), EstadoOrden.PENDIENTE_PAGO, List.of(item("1500000000", 1))))));
        assertThat(new Compra(UUID.randomUUID(), new BigDecimal("2000000000")).getMontoTotal())
                .isEqualByComparingTo("2000000000");
    }

    @Test
    void noPermiteDuplicarCafeteriasOfertasNiReutilizarSnapshots() {
        UUID cafeteria = UUID.randomUUID();
        assertThatIllegalArgumentException().isThrownBy(() -> new Compra(UUID.randomUUID(), Instant.now(), List.of(
                orden(cafeteria, EstadoOrden.PENDIENTE_PAGO, List.of(item("100", 1))),
                orden(cafeteria, EstadoOrden.PENDIENTE_PAGO, List.of(item("100", 1))))));
        UUID oferta = UUID.randomUUID();
        assertThatIllegalArgumentException().isThrownBy(() -> orden(cafeteria, EstadoOrden.PENDIENTE_PAGO, List.of(
                new OrdenItem(oferta, UUID.randomUUID(), "Café", 1, BigDecimal.ONE),
                new OrdenItem(oferta, UUID.randomUUID(), "Café", 1, BigDecimal.ONE))));
        OrdenItem item = item("100", 1);
        orden(cafeteria, EstadoOrden.PENDIENTE_PAGO, List.of(item));
        assertThatIllegalArgumentException().isThrownBy(() -> orden(cafeteria, EstadoOrden.PENDIENTE_PAGO, List.of(item)));
    }

    @Test
    void unaCompraNuevaNoPuedeNacerPagadaNiSinItems() {
        assertThatIllegalArgumentException().isThrownBy(() -> orden(UUID.randomUUID(), EstadoOrden.PAGADO,
                List.of(item("100", 1))));
        assertThatIllegalArgumentException().isThrownBy(() -> orden(UUID.randomUUID(), EstadoOrden.PENDIENTE_PAGO, List.of()));
        assertThatIllegalArgumentException().isThrownBy(() -> new Compra(UUID.randomUUID(), Instant.now(), List.of()));
    }

    private static OrdenItem item(String precio, int cantidad) {
        return new OrdenItem(UUID.randomUUID(), UUID.randomUUID(), "Café al reservar", cantidad, new BigDecimal(precio));
    }

    private static Orden orden(UUID cafeteria, EstadoOrden estado, List<OrdenItem> items) {
        return new Orden("CC-" + UUID.randomUUID(), cafeteria, "Cafetería al reservar", estado, items);
    }
}
