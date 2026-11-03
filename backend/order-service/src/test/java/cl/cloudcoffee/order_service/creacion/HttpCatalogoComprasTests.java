package cl.cloudcoffee.order_service.creacion;

import static org.assertj.core.api.Assertions.*;
import com.sun.net.httpserver.HttpServer;
import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.*;
import tools.jackson.databind.json.JsonMapper;

class HttpCatalogoComprasTests {
    private HttpServer server;
    private HttpCatalogoCompras client;
    private final JsonMapper json = JsonMapper.builder().findAndAddModules().build();
    private final UUID orden = UUID.randomUUID(), oferta = UUID.randomUUID(), intento = UUID.randomUUID(), reserva = UUID.randomUUID();
    private final Instant vence = Instant.now().plusSeconds(800).truncatedTo(java.time.temporal.ChronoUnit.MICROS);
    private final AtomicInteger status = new AtomicInteger(200);
    private String response;
    private final List<String> paths = new ArrayList<>();
    private final List<String> bodies = new ArrayList<>();
    private final List<String> tokens = new ArrayList<>();
    private static final String TOKEN = "token-interno-exclusivo-de-tests-12345678";

    @BeforeEach void http() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            paths.add(exchange.getRequestURI().getPath());
            tokens.add(exchange.getRequestHeaders().getFirst("X-Internal-Service-Token"));
            bodies.add(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(status.get(), bytes.length);
            exchange.getResponseBody().write(bytes); exchange.close();
        });
        server.start();
        client = new HttpCatalogoCompras("http://127.0.0.1:" + server.getAddress().getPort(), TOKEN, Duration.ofSeconds(2), json);
    }
    @AfterEach void cerrar() { server.stop(0); }

    @Test void usaContratoInternoAutenticadoYCotizacionYVencimientoExactos() {
        response = json.writeValueAsString(List.of(new CatalogoCompras.Oferta(oferta, UUID.randomUUID(), "Café", UUID.randomUUID(),
                "Central", UUID.randomUUID(), BigDecimal.valueOf(1800))));
        assertThat(client.cotizar(List.of(oferta))).hasSize(1);
        response = json.writeValueAsString(new CatalogoCompras.Reserva(reserva, orden, oferta, intento, 2, "RESERVED", Instant.now(), vence));
        assertThat(client.reservar(orden, oferta, 2, intento, vence, BigDecimal.valueOf(1800)).reservationId()).isEqualTo(reserva);
        var body = json.readTree(bodies.get(1));
        assertThat(body.path("expectedPrice").asInt()).isEqualTo(1800);
        assertThat(Instant.parse(body.path("expiresAt").asString())).isEqualTo(vence);
        assertThat(body.path("attemptId").asString()).isEqualTo(intento.toString());
        response = json.writeValueAsString(new CatalogoCompras.Reserva(reserva, orden, oferta, intento, 2, "RELEASED", Instant.now(), vence));
        client.liberar(reserva);
        assertThat(paths).containsExactly("/internal/servicios/catalogo/cotizaciones", "/internal/servicios/catalogo/reservas",
                "/internal/servicios/catalogo/reservas/" + reserva + "/liberar");
        assertThat(tokens).containsOnly(TOKEN);
    }

    @Test void soloUn409ConCodigoConocidoEsRechazoDeNegocio() {
        for (int httpStatus : List.of(401, 403, 404, 500, 503)) {
            status.set(httpStatus); response = "{\"code\":\"STOCK_NO_DISPONIBLE\"}";
            assertThatThrownBy(() -> client.cotizar(List.of(oferta))).isInstanceOf(CatalogoCompras.NoDisponible.class);
        }
        status.set(409); response = "{\"code\":\"STOCK_NO_DISPONIBLE\"}";
        assertThatThrownBy(() -> client.reservar(orden, oferta, 2, intento, vence, BigDecimal.ONE))
                .isInstanceOf(CatalogoCompras.Rechazo.class);
        response = "{\"code\":\"DESCONOCIDO\"}";
        assertThatThrownBy(() -> client.cotizar(List.of(oferta))).isInstanceOf(CatalogoCompras.NoDisponible.class);
        response = "{}";
        assertThatThrownBy(() -> client.cotizar(List.of(oferta))).isInstanceOf(CatalogoCompras.NoDisponible.class);
    }

    @Test void unaReservaInconsistenteNoSeDaPorValida() {
        response = json.writeValueAsString(new CatalogoCompras.Reserva(reserva, orden, oferta, intento, 2, "RESERVED", Instant.now(), vence.plusSeconds(1)));
        assertThatThrownBy(() -> client.reservar(orden, oferta, 2, intento, vence, BigDecimal.ONE))
                .isInstanceOf(CatalogoCompras.NoDisponible.class);
        response = "{}";
        assertThatThrownBy(() -> client.liberar(reserva)).isInstanceOf(CatalogoCompras.NoDisponible.class);
    }
}
