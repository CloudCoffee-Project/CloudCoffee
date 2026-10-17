package cl.cloudcoffee.catalog_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import cl.cloudcoffee.catalog_service.messaging.CloudCoffeeEvent;
import cl.cloudcoffee.catalog_service.messaging.PagoAprobadoConsumer;
import cl.cloudcoffee.catalog_service.repository.OfferRepository;
import cl.cloudcoffee.security.testing.JwtTestSupport;

/**
 * INT2-77: un pago aprobado descuenta el stock una sola vez por eventId. Usa el seed
 * de catálogo (INT2-36) en su propia base H2 para no tocar la base compartida de CI.
 */
@SpringBootTest(properties = {
        "management.tracing.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:stock-confirmacion;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password="
})
@ActiveProfiles("dev")
class StockConfirmacionTests extends JwtTestSupport {

    // Ofertas de Cafetería Central en el seed: americano (stock 40) y cappuccino (stock 25).
    static final UUID AMERICANO_CENTRAL = UUID.fromString("55555555-5555-4555-8555-555555555501");
    static final UUID CAPPUCCINO_CENTRAL = UUID.fromString("55555555-5555-4555-8555-555555555502");

    @Autowired PagoAprobadoConsumer consumer;
    @Autowired OfferRepository offers;

    @Test
    void pagoAprobadoDescuentaElStockUnaSolaVezPorEventId() {
        int americano = stock(AMERICANO_CENTRAL);
        int cappuccino = stock(CAPPUCCINO_CENTRAL);
        CloudCoffeeEvent evento = aprobado(UUID.randomUUID(),
                item(AMERICANO_CENTRAL, 2), item(CAPPUCCINO_CENTRAL, 1));

        consumer.consume(evento);
        consumer.consume(evento);
        consumer.consume(evento);

        assertThat(stock(AMERICANO_CENTRAL)).isEqualTo(americano - 2);
        assertThat(stock(CAPPUCCINO_CENTRAL)).isEqualTo(cappuccino - 1);
    }

    @Test
    void otroEventoConfirmaOtraVenta() {
        int americano = stock(AMERICANO_CENTRAL);

        consumer.consume(aprobado(UUID.randomUUID(), item(AMERICANO_CENTRAL, 1)));
        consumer.consume(aprobado(UUID.randomUUID(), item(AMERICANO_CENTRAL, 1)));

        assertThat(stock(AMERICANO_CENTRAL)).isEqualTo(americano - 2);
    }

    @Test
    void elStockNoQuedaNegativoNiFallaPorUnaOfertaInexistente() {
        UUID latte = UUID.fromString("55555555-5555-4555-8555-555555555503"); // stock 0 en el seed

        consumer.consume(aprobado(UUID.randomUUID(), item(latte, 3), item(UUID.randomUUID(), 1)));

        assertThat(stock(latte)).isZero();
    }

    @Test
    void ignoraTiposDeEventoQueNoSonPagoAprobado() {
        int americano = stock(AMERICANO_CENTRAL);

        consumer.consume(new CloudCoffeeEvent(UUID.randomUUID(), Instant.now(), "trace", "order.pago.rechazado.v1",
                Map.of("items", List.of(item(AMERICANO_CENTRAL, 5)))));

        assertThat(stock(AMERICANO_CENTRAL)).isEqualTo(americano);
    }

    @Test
    void rechazaEventosSinEventIdNiItems() {
        assertThatIllegalArgumentException().isThrownBy(() -> consumer.consume(
                new CloudCoffeeEvent(null, Instant.now(), "trace", "order.pago.aprobado.v1", Map.of())));
        assertThatIllegalArgumentException().isThrownBy(() -> consumer.consume(
                new CloudCoffeeEvent(UUID.randomUUID(), Instant.now(), "trace", "order.pago.aprobado.v1", Map.of())));
    }

    private int stock(UUID ofertaId) {
        return offers.findById(ofertaId).orElseThrow().getStock();
    }

    @SafeVarargs
    private static CloudCoffeeEvent aprobado(UUID eventId, Map<String, Object>... items) {
        return new CloudCoffeeEvent(eventId, Instant.now(), "trace-" + eventId, "order.pago.aprobado.v1",
                Map.of("compraId", UUID.randomUUID().toString(), "items", List.of(items)));
    }

    private static Map<String, Object> item(UUID ofertaId, int cantidad) {
        return Map.of("ofertaId", ofertaId.toString(), "cantidad", cantidad);
    }
}
