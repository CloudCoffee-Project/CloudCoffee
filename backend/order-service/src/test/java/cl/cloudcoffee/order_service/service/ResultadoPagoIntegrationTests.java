package cl.cloudcoffee.order_service.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import cl.cloudcoffee.order_service.creacion.CatalogoCompras;
import cl.cloudcoffee.order_service.dto.CompraResponse;
import cl.cloudcoffee.order_service.model.Compra;
import cl.cloudcoffee.order_service.model.EstadoPago;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.order_service.repository.PagoRepository;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import com.nimbusds.jose.JWSAlgorithm;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** INT2-77: pago, estado de compra/órdenes y stock se mantienen coherentes. */
@SpringBootTest(properties = {"management.tracing.enabled=false", "cloudcoffee.creation.recovery-enabled=false",
        "cloudcoffee.creation.publish-enabled=false", "cloudcoffee.revision.recovery-enabled=false",
        "cloudcoffee.pagos.recovery-enabled=true", "cloudcoffee.pagos.scan-ms=3600000"})
@AutoConfigureMockMvc
class ResultadoPagoIntegrationTests extends JwtTestSupport {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired JsonMapper json;
    @Autowired CatalogFake catalog;
    @Autowired ConsultaComprasService consultas;
    @Autowired ResultadoPagoService resultados;
    @Autowired RecuperacionPagos recuperacion;
    @Autowired PagoRepository pagos;
    @Autowired CompraRepository compras;
    final UUID cliente = UUID.randomUUID();
    UUID oferta1, oferta2;

    @BeforeEach void preparar() {
        catalog.reset();
        // Otras pruebas de esta clase no deben influir en el job.
        jdbc.update("DELETE FROM liberaciones_reserva");
        UUID campus = UUID.randomUUID();
        oferta1 = catalog.oferta(campus, UUID.randomUUID(), 1800, 10);
        oferta2 = catalog.oferta(campus, UUID.randomUUID(), 900, 10);
    }

    @Test void aprobarConfirmaElStockSinDescontarDosVecesYPagaCompraYOrdenes() throws Exception {
        CompraResponse compra = crear();
        assertThat(catalog.stock.values()).containsOnly(9);

        MvcResult respuesta = pagar(compra, "aprobar", UUID.randomUUID());

        assertStatus(respuesta, 201);
        assertThat(cuerpo(respuesta).path("estado").asString()).isEqualTo("aprobado");
        assertThat(cuerpo(respuesta).path("motivo").asString()).isEqualTo("aprobacion_simulada");
        assertThat(catalog.estados()).containsOnly("CONFIRMED");
        assertThat(catalog.stock.values()).containsOnly(9);
        CompraResponse actual = consultas.compra(cliente, compra.compraId());
        assertThat(actual.estado()).isEqualTo("pagado");
        assertThat(actual.montoTotal()).isEqualTo(compra.montoTotal());
        assertThat(actual.pago().estado()).isEqualTo("aprobado");
        assertThat(actual.ordenes()).allSatisfy(orden -> {
            assertThat(orden.estado()).isEqualTo("pagado");
            assertThat(Duration.between(Instant.now(), orden.retiroHasta()))
                    .isBetween(Duration.ofMinutes(119), Duration.ofMinutes(120));
        });
    }

    @Test void rechazarLiberaLasReservasYCancelaCompraYOrdenes() throws Exception {
        CompraResponse compra = crear();

        MvcResult respuesta = pagar(compra, "rechazar", UUID.randomUUID());

        assertStatus(respuesta, 201);
        assertThat(cuerpo(respuesta).path("estado").asString()).isEqualTo("rechazado");
        assertThat(cuerpo(respuesta).path("motivo").asString()).isEqualTo("rechazo_simulado");
        assertThat(cuerpo(respuesta).path("version").asInt()).isEqualTo(1);
        assertThat(catalog.estados()).containsOnly("RELEASED");
        assertThat(catalog.stock.values()).containsOnly(10);
        assertThat(reservas(compra)).isZero();
        CompraResponse actual = consultas.compra(cliente, compra.compraId());
        assertThat(actual.estado()).isEqualTo("cancelado");
        assertThat(actual.montoTotal()).isZero();
        assertThat(actual.ordenes()).allMatch(orden -> orden.estado().equals("cancelado"));
    }

    @Test void rechazoConCatalogCaidoLiberaDespuesUnaSolaVez() throws Exception {
        CompraResponse compra = crear();
        catalog.caido = true;

        assertStatus(pagar(compra, "rechazar", UUID.randomUUID()), 201);

        assertThat(consultas.compra(cliente, compra.compraId()).estado()).isEqualTo("cancelado");
        assertThat(liberacionesPendientes()).isEqualTo(2);
        assertThat(catalog.stock.values()).containsOnly(9);
        recuperacion.recuperar();
        assertThat(liberacionesPendientes()).isEqualTo(2);

        catalog.caido = false;
        recuperacion.recuperar();
        recuperacion.recuperar();

        assertThat(liberacionesPendientes()).isZero();
        assertThat(catalog.stock.values()).containsOnly(10);
    }

    @Test void pendienteConservaLaReservaHastaElVencimientoAcordadoYLuegoSeRechaza() throws Exception {
        CompraResponse compra = crear();
        MvcResult respuesta = pagar(compra, "pendiente", UUID.randomUUID());
        assertStatus(respuesta, 201);
        assertThat(cuerpo(respuesta).path("motivo").asString()).isEqualTo("escenario_pendiente");

        recuperacion.recuperar();

        assertThat(catalog.estados()).containsOnly("RESERVED");
        assertThat(catalog.stock.values()).containsOnly(9);
        assertThat(consultas.compra(cliente, compra.compraId()).estado()).isEqualTo("pendiente_pago");
        assertStatus(pagar(compra, "aprobar", UUID.randomUUID()), 409);
        assertThat(catalog.estados()).containsOnly("RESERVED");

        vencer(compra);
        recuperacion.recuperar();

        CompraResponse actual = consultas.compra(cliente, compra.compraId());
        assertThat(actual.pago().estado()).isEqualTo("rechazado");
        assertThat(actual.pago().motivo()).isEqualTo("reserva_vencida");
        assertThat(actual.estado()).isEqualTo("cancelado");
        assertThat(actual.ordenes()).allMatch(orden -> orden.estado().equals("cancelado"));
        assertThat(catalog.estados()).containsOnly("RELEASED");
        assertThat(catalog.stock.values()).containsOnly(10);

        int eventos = eventos(compra).size();
        recuperacion.recuperar();
        assertThat(eventos(compra)).hasSize(eventos);
    }

    @Test void catalogCaidoDejaLaAprobacionPendienteYSeReanudaConLaMismaTraza() throws Exception {
        CompraResponse compra = crear();
        UUID clave = UUID.randomUUID();
        catalog.caido = true;

        MvcResult respuesta = pagar(compra, "aprobar", clave);

        assertStatus(respuesta, 201);
        assertThat(cuerpo(respuesta).path("estado").asString()).isEqualTo("pendiente");
        assertThat(cuerpo(respuesta).path("motivo").asString()).isEqualTo("procesando_stock");
        assertThat(consultas.compra(cliente, compra.compraId()).estado()).isEqualTo("pendiente_pago");
        assertThat(catalog.estados()).containsOnly("RESERVED");
        UUID pago = UUID.fromString(cuerpo(respuesta).path("pagoId").asString());
        // Una caída no es un rechazo: la reserva sigue reservada mientras no haya respuesta.
        assertThat(resultados.resolverAprobacion(pago)).isFalse();
        assertThat(liberacionesPendientes()).isZero();

        catalog.caido = false;
        jdbc.update("UPDATE pagos SET created_at=? WHERE id=?", java.time.LocalDateTime.of(2020, 1, 1, 0, 0), pago);
        recuperacion.recuperar();

        CompraResponse actual = consultas.compra(cliente, compra.compraId());
        assertThat(actual.pago().estado()).isEqualTo("aprobado");
        assertThat(actual.pago().version()).isEqualTo(2);
        assertThat(actual.estado()).isEqualTo("pagado");
        assertThat(catalog.estados()).containsOnly("CONFIRMED");
        assertThat(eventosPago(compra).stream().map(e -> e.path("traceId").asString()).distinct()).hasSize(1);
        assertThat(eventosPago(compra).stream().map(e -> e.at("/payload/estado").asString()))
                .containsExactlyInAnyOrder("pendiente", "aprobado");
        // La primera respuesta fue pendiente: repetir la clave la reproduce; GET da el estado actual.
        MvcResult replay = pagar(compra, "aprobar", clave);
        assertThat(replay.getResponse().getContentAsString()).isEqualTo(respuesta.getResponse().getContentAsString());
        assertThat(replay.getResponse().getHeader("Idempotency-Replayed")).isEqualTo("true");
    }

    @Test void publicaElResultadoConEventIdTraceIdYElPayloadDelContrato() throws Exception {
        CompraResponse compra = crear();
        int creacion = eventos(compra).size();

        assertStatus(pagar(compra, "rechazar", UUID.randomUUID()), 201);

        List<JsonNode> nuevos = eventos(compra);
        assertThat(nuevos).hasSize(creacion + 4);
        assertThat(nuevos.stream().map(e -> e.path("eventId").asString()).distinct()).hasSameSizeAs(nuevos);
        JsonNode pago = eventosPago(compra).getFirst();
        assertThat(pago.path("eventId").asString()).isNotBlank();
        assertThat(UUID.fromString(pago.path("eventId").asString())).isNotNull();
        assertThat(pago.path("traceId").asString()).matches("[a-f0-9]{32}");
        assertThat(pago.path("timestamp").asString()).isNotBlank();
        JsonNode payload = pago.path("payload");
        assertThat(payload.propertyNames()).containsExactlyInAnyOrder("pagoId", "compraId", "clienteId", "estado",
                "motivo", "montoTotal", "moneda", "simulado", "version");
        assertThat(payload.path("clienteId").asString()).isEqualTo(cliente.toString());
        assertThat(payload.path("montoTotal").asLong()).isEqualTo(compra.montoTotal());
        assertThat(payload.path("simulado").asBoolean()).isTrue();
        JsonNode compraEvento = eventos(compra).stream()
                .filter(e -> e.path("eventType").asString().equals("order.compra.estado-cambiado.v1")).findFirst().orElseThrow();
        assertThat(compraEvento.at("/payload/estadoAnterior").asString()).isEqualTo("pendiente_pago");
        assertThat(compraEvento.at("/payload/estado").asString()).isEqualTo("cancelado");
        assertThat(compraEvento.at("/payload/montoTotal").asLong()).isZero();
        assertThat(compraEvento.path("traceId").asString()).isEqualTo(pago.path("traceId").asString());
        assertThat(eventos(compra).stream().filter(e -> e.path("eventType").asString().equals("order.orden.estado-cambiado.v1"))
                .filter(e -> e.at("/payload/estado").asString().equals("cancelado"))).hasSize(2);
    }

    @Test void resultadoRepetidoNoRepiteEfectosNiEventos() throws Exception {
        CompraResponse compra = crear();
        UUID clave = UUID.randomUUID();
        MvcResult primera = pagar(compra, "aprobar", clave);
        assertThat(cuerpo(primera).path("estado").asString()).isEqualTo("aprobado");
        UUID pago = UUID.fromString(cuerpo(primera).path("pagoId").asString());
        int eventos = eventos(compra).size();
        long version = pagos.findById(pago).orElseThrow().getVersion();
        long versionCompra = consultas.compra(cliente, compra.compraId()).version();

        MvcResult replay = pagar(compra, "aprobar", clave);
        assertThat(resultados.resolverAprobacion(pago)).isFalse();
        resultados.vencerPendiente(pago);
        recuperacion.recuperar();

        assertStatus(replay, 201);
        assertThat(replay.getResponse().getContentAsString()).isEqualTo(primera.getResponse().getContentAsString());
        assertThat(replay.getResponse().getHeader("Idempotency-Replayed")).isEqualTo("true");
        assertThat(eventos(compra)).hasSize(eventos);
        assertThat(pagos.findById(pago).orElseThrow().getVersion()).isEqualTo(version);
        assertThat(consultas.compra(cliente, compra.compraId()).version()).isEqualTo(versionCompra);
        assertThat(catalog.confirmaciones).hasSize(2);
        assertThat(catalog.stock.values()).containsOnly(9);
    }

    @Test void transicionInvalidaNoCambiaPagoCompraNiStock() throws Exception {
        CompraResponse aprobada = crear();
        MvcResult aprobado = pagar(aprobada, "aprobar", UUID.randomUUID());
        CompraResponse rechazada = crear();
        MvcResult rechazado = pagar(rechazada, "rechazar", UUID.randomUUID());
        int eventosAprobada = eventos(aprobada).size(), eventosRechazada = eventos(rechazada).size();

        MvcResult otroPago = pagar(rechazada, "aprobar", UUID.randomUUID());
        MvcResult contradictorio = pagar(aprobada, "rechazar", UUID.randomUUID());

        assertStatus(otroPago, 409);
        assertThat(cuerpo(otroPago).path("code").asString()).isEqualTo("PAGO_YA_INICIADO");
        assertStatus(contradictorio, 409);
        assertThat(cuerpo(contradictorio).path("code").asString()).isEqualTo("PAGO_YA_INICIADO");
        assertThat(cuerpo(aprobado).path("estado").asString()).isEqualTo("aprobado");
        assertThat(cuerpo(rechazado).path("estado").asString()).isEqualTo("rechazado");
        assertThat(consultas.compra(cliente, aprobada.compraId()).estado()).isEqualTo("pagado");
        assertThat(consultas.compra(cliente, rechazada.compraId()).estado()).isEqualTo("cancelado");
        assertThat(eventos(aprobada)).hasSize(eventosAprobada);
        assertThat(eventos(rechazada)).hasSize(eventosRechazada);
    }

    @Test void pagarUnaCompraConReservasVencidasEsRechazadoSinCrearPago() throws Exception {
        CompraResponse compra = crear();
        vencer(compra);

        MvcResult respuesta = pagar(compra, "aprobar", UUID.randomUUID());

        assertStatus(respuesta, 409);
        assertThat(cuerpo(respuesta).path("code").asString()).isEqualTo("RESERVA_VENCIDA");
        assertThat(pagos.existsByCompraId(compra.compraId())).isFalse();
        assertThat(catalog.confirmaciones).isEmpty();
    }

    @Test void siCatalogInformaLaReservaVencidaSeRechazaSinConfirmarElResto() throws Exception {
        CompraResponse compra = crear();
        catalog.vencer();

        MvcResult respuesta = pagar(compra, "aprobar", UUID.randomUUID());

        assertStatus(respuesta, 201);
        assertThat(cuerpo(respuesta).path("estado").asString()).isEqualTo("rechazado");
        assertThat(cuerpo(respuesta).path("motivo").asString()).isEqualTo("reserva_vencida");
        assertThat(consultas.compra(cliente, compra.compraId()).estado()).isEqualTo("cancelado");
        assertThat(catalog.estados()).doesNotContain("CONFIRMED");
        assertThat(liberacionesPendientes()).isZero();
    }

    @Test void unaReservaConfirmadaNuncaSeLiberaSiLaSiguienteVencio() throws Exception {
        CompraResponse compra = crear();
        List<UUID> ordenadas = jdbc.queryForList("""
                SELECT r.reserva_id FROM orden_reservas r JOIN ordenes o ON o.id = r.orden_id
                WHERE o.compra_id=? ORDER BY r.reserva_id
                """, UUID.class, compra.compraId());
        catalog.vencer(ordenadas.get(1));

        MvcResult respuesta = pagar(compra, "aprobar", UUID.randomUUID());

        assertThat(cuerpo(respuesta).path("motivo").asString()).isEqualTo("reserva_vencida");
        assertThat(catalog.estado(ordenadas.get(0))).isEqualTo("CONFIRMED");
        assertThat(catalog.liberadas).doesNotContain(ordenadas.get(0));
        assertThat(liberacionesPendientes()).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM orden_reservas WHERE reserva_id=?", Integer.class, ordenadas.get(0))).isEqualTo(1);
    }

    @Test void unaCompraMinimaSinReservasSeResuelveDeInmediatoYNoVence() throws Exception {
        Compra aprobada = compras.saveAndFlush(new Compra(cliente, new BigDecimal("3700.00")));
        Compra pendiente = compras.saveAndFlush(new Compra(cliente, new BigDecimal("1500.00")));
        jdbc.update("UPDATE compras SET reserva_expira_at=? WHERE id IN (?, ?)",
                java.time.LocalDateTime.of(2020, 1, 1, 0, 0), aprobada.getId(), pendiente.getId());

        MvcResult respuesta = pagarCompra(aprobada.getId(), "aprobar", UUID.randomUUID());
        assertStatus(pagarCompra(pendiente.getId(), "pendiente", UUID.randomUUID()), 201);
        recuperacion.recuperar();

        assertThat(cuerpo(respuesta).path("estado").asString()).isEqualTo("aprobado");
        assertThat(cuerpo(respuesta).path("version").asInt()).isEqualTo(1);
        assertThat(compras.findById(aprobada.getId()).orElseThrow().getEstado().codigo()).isEqualTo("pagado");
        assertThat(pagos.findByCompraId(pendiente.getId()).orElseThrow().getEstado()).isEqualTo(EstadoPago.PENDIENTE);
    }

    private CompraResponse crear() throws Exception {
        var items = Arrays.asList(Map.of("ofertaId", oferta1, "cantidad", 1), Map.of("ofertaId", oferta2, "cantidad", 1));
        var respuesta = mvc.perform(post("/compras").header("Authorization", bearer())
                .header("Idempotency-Key", UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("items", items)))).andReturn();
        assertStatus(respuesta, 201);
        CompraResponse compra = json.readValue(respuesta.getResponse().getContentAsString(), CompraResponse.class);
        assertThat(compra.estado()).isEqualTo("pendiente_pago");
        return compra;
    }
    private MvcResult pagar(CompraResponse compra, String escenario, UUID clave) throws Exception {
        return pagarCompra(compra.compraId(), escenario, clave);
    }
    private MvcResult pagarCompra(UUID compra, String escenario, UUID clave) throws Exception {
        return mvc.perform(post("/compras/" + compra + "/pago").header("Authorization", bearer())
                .header("Idempotency-Key", clave).contentType(MediaType.APPLICATION_JSON)
                .content("{\"escenario\":\"" + escenario + "\"}")).andReturn();
    }
    private void vencer(CompraResponse compra) {
        jdbc.update("UPDATE compras SET reserva_expira_at=? WHERE id=?", java.time.LocalDateTime.of(2020, 1, 1, 0, 0), compra.compraId());
    }
    private int reservas(CompraResponse compra) {
        return jdbc.queryForObject("SELECT count(*) FROM orden_reservas WHERE orden_id IN (SELECT id FROM ordenes WHERE compra_id=?)",
                Integer.class, compra.compraId());
    }
    private int liberacionesPendientes() {
        return jdbc.queryForObject("SELECT count(*) FROM liberaciones_reserva", Integer.class);
    }
    private List<JsonNode> eventos(CompraResponse compra) {
        return new ArrayList<>(jdbc.queryForList("SELECT cuerpo FROM order_outbox WHERE cuerpo LIKE ?", String.class,
                "%" + compra.compraId() + "%").stream().map(json::readTree).toList());
    }
    private List<JsonNode> eventosPago(CompraResponse compra) {
        return eventos(compra).stream().filter(e -> e.path("eventType").asString().equals("order.pago.resultado.v1")).toList();
    }
    private JsonNode cuerpo(MvcResult resultado) throws Exception {
        return json.readTree(resultado.getResponse().getContentAsString());
    }
    private static void assertStatus(MvcResult resultado, int status) throws Exception {
        assertThat(resultado.getResponse().getStatus()).withFailMessage(resultado.getResponse().getContentAsString()).isEqualTo(status);
    }
    private String bearer() {
        return "Bearer " + sign(claims().subject(cliente.toString()).claim("role", "CLIENTE").build(), KEYS, JWSAlgorithm.RS256);
    }

    @TestConfiguration static class Config { @Bean @Primary CatalogFake catalogFake() { return new CatalogFake(); } }

    /** Mismas reglas que Catalog: confirmar no descuenta; liberar restaura una vez; una confirmada no se libera. */
    static class CatalogFake implements CatalogoCompras {
        final Map<UUID, Oferta> ofertas = new ConcurrentHashMap<>();
        final Map<UUID, Integer> stock = new ConcurrentHashMap<>();
        final Map<UUID, Reserva> reservas = new ConcurrentHashMap<>();
        final List<UUID> confirmaciones = new ArrayList<>();
        final List<UUID> liberadas = new ArrayList<>();
        volatile boolean caido;
        void reset() {
            ofertas.clear(); stock.clear(); reservas.clear(); confirmaciones.clear(); liberadas.clear(); caido = false;
        }
        UUID oferta(UUID campus, UUID cafeteria, long precio, int unidades) {
            UUID id = UUID.randomUUID();
            ofertas.put(id, new Oferta(id, UUID.randomUUID(), "Café", cafeteria, "Central", campus, BigDecimal.valueOf(precio)));
            stock.put(id, unidades);
            return id;
        }
        Set<String> estados() {
            return Set.copyOf(reservas.values().stream().map(Reserva::status).toList());
        }
        String estado(UUID reserva) { return reservas.get(reserva).status(); }
        void vencer() { reservas.keySet().forEach(this::vencer); }
        synchronized void vencer(UUID id) {
            Reserva r = reservas.get(id);
            stock.compute(r.offerId(), (oferta, n) -> n + r.quantity());
            cambiar(r, "EXPIRED");
        }
        private void cambiar(Reserva r, String estado) {
            reservas.put(r.reservationId(), new Reserva(r.reservationId(), r.orderId(), r.offerId(), r.attemptId(),
                    r.quantity(), estado, r.reservedAt(), r.expiresAt()));
        }
        public List<Oferta> cotizar(List<UUID> ids) { return ids.stream().map(ofertas::get).filter(Objects::nonNull).toList(); }
        public synchronized Reserva reservar(UUID orden, UUID oferta, int cantidad, UUID intento, Instant vence, BigDecimal precio) {
            for (Reserva r : reservas.values()) if (r.orderId().equals(orden) && r.offerId().equals(oferta) && r.attemptId().equals(intento)) return r;
            stock.compute(oferta, (id, n) -> n - cantidad);
            Reserva reserva = new Reserva(UUID.randomUUID(), orden, oferta, intento, cantidad, "RESERVED", Instant.now(), vence);
            reservas.put(reserva.reservationId(), reserva);
            return reserva;
        }
        public synchronized boolean confirmar(UUID id) {
            if (caido) throw new NoDisponible();
            Reserva r = reservas.get(id);
            if (r.status().equals("EXPIRED") || r.status().equals("RELEASED")) return false;
            if (r.status().equals("RESERVED")) { cambiar(r, "CONFIRMED"); confirmaciones.add(id); }
            return true;
        }
        public synchronized void liberar(UUID id) {
            if (caido) throw new NoDisponible();
            Reserva r = reservas.get(id);
            if (r.status().equals("CONFIRMED")) throw new NoDisponible();
            if (r.status().equals("RESERVED")) {
                stock.compute(r.offerId(), (oferta, n) -> n + r.quantity());
                cambiar(r, "RELEASED");
                liberadas.add(id);
            }
        }
    }
}
