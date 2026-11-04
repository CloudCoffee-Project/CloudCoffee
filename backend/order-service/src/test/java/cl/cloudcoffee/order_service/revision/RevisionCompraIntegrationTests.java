package cl.cloudcoffee.order_service.revision;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import cl.cloudcoffee.order_service.creacion.CatalogoCompras;
import cl.cloudcoffee.order_service.dto.CompraResponse;
import cl.cloudcoffee.order_service.dto.OrdenResponse;
import cl.cloudcoffee.order_service.model.*;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.order_service.repository.PagoRepository;
import cl.cloudcoffee.order_service.service.ConsultaComprasService;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import com.nimbusds.jose.JWSAlgorithm;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
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
import org.springframework.transaction.PlatformTransactionManager;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(properties = {"management.tracing.enabled=false", "cloudcoffee.creation.recovery-enabled=false",
        "cloudcoffee.creation.publish-enabled=false", "cloudcoffee.revision.recovery-enabled=false"})
@AutoConfigureMockMvc
class RevisionCompraIntegrationTests extends JwtTestSupport {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired JsonMapper json;
    @Autowired CatalogFake catalog;
    @Autowired ConsultaComprasService consultas;
    @Autowired RevisionCompraService revisiones;
    @Autowired DiarioRevision diario;
    @Autowired EventosRevision eventos;
    @Autowired EntityManager em;
    @Autowired PlatformTransactionManager manager;
    @Autowired CompraRepository compras;
    @Autowired PagoRepository pagos;
    final UUID cliente = UUID.randomUUID();
    UUID oferta1, oferta2, oferta3;

    @BeforeEach void prepararCatalogo() {
        catalog.reset();
        UUID campus = UUID.randomUUID(), cafeteria = UUID.randomUUID();
        oferta1 = catalog.oferta(campus, cafeteria, 1800, 0);
        oferta2 = catalog.oferta(campus, cafeteria, 900, 10);
        oferta3 = catalog.oferta(campus, UUID.randomUUID(), 1200, 10);
    }

    @Test void confirmaUnaOrdenSinRecotizarNiDescontarLaYaReservada() throws Exception {
        CompraResponse compra = crear(oferta1, oferta2, oferta3);
        OrdenResponse revision = revision(compra);
        catalog.stock.put(oferta1, 10);
        catalog.precio(oferta3, 9999); // su reserva vigente conserva el snapshot de 1200.
        UUID clave = UUID.randomUUID();
        MvcResult resultado = accion("/orders/" + revision.ordenId() + "/confirmar", clave);
        assertStatus(resultado, 200);
        assertThat(datos(resultado).path("estado").asString()).isEqualTo("pendiente_pago");
        CompraResponse actual = consultas.compra(cliente, compra.compraId());
        assertThat(actual.estado()).isEqualTo("pendiente_pago");
        assertThat(actual.montoTotal()).isEqualTo(3900);
        assertThat(actual.version()).isEqualTo(2);
        assertThat(catalog.stock.get(oferta1)).isEqualTo(9);
        assertThat(catalog.stock.get(oferta2)).isEqualTo(9);
        assertThat(catalog.stock.get(oferta3)).isEqualTo(9);
        assertThat(catalog.ultimaCotizacion).containsExactlyInAnyOrder(oferta1, oferta2);
        assertThat(referenciaReservas(compra.compraId())).isEqualTo(3);
        int eventosAntes = eventos(compra.compraId());
        var replay = accion("/orders/" + revision.ordenId() + "/confirmar", clave);
        assertStatus(replay, 200);
        assertThat(replay.getResponse().getContentAsString()).isEqualTo(resultado.getResponse().getContentAsString());
        assertThat(replay.getResponse().getHeader("Idempotency-Replayed")).isEqualTo("true");
        assertThat(replay.getResponse().getHeader("Cache-Control")).isEqualTo("no-store");
        assertThat(eventos(compra.compraId())).isEqualTo(eventosAntes);
    }

    @Test void confirmaCompraCompletaConDosCafeteriasEnRevision() throws Exception {
        catalog.stock.put(oferta3, 0);
        var compra = crear(oferta1, oferta2, oferta3);
        catalog.stock.replaceAll((id, n) -> 10);
        var respuesta = accion("/compras/" + compra.compraId() + "/confirmar", UUID.randomUUID());
        assertStatus(respuesta, 200);
        assertThat(datos(respuesta).path("ordenes").size()).isEqualTo(2);
        assertThat(consultas.compra(cliente, compra.compraId()).ordenes()).allMatch(o -> o.estado().equals("pendiente_pago"));
        assertThat(catalog.stock.values()).containsOnly(9);
        assertThat(referenciaReservas(compra.compraId())).isEqualTo(3);
    }

    @Test void siFallaUnaOrdenCompensaTodasLasReservasNuevasYConservaLasAnteriores() throws Exception {
        catalog.stock.put(oferta3, 0);
        var o = catalog.ofertas.get(oferta1);
        UUID reservada = catalog.oferta(o.campusId(), UUID.randomUUID(), 500, 10);
        var compra = crear(oferta1, oferta2, oferta3, reservada);
        catalog.stock.put(oferta1, 10); catalog.stock.put(oferta3, 10);
        var enRevision = compra.ordenes().stream().filter(ord -> ord.estado().equals("revision_requerida")).toList();
        UUID sinStock = enRevision.getLast().items().getLast().ofertaId();
        catalog.stock.put(sinStock, 0);
        int antes = eventos(compra.compraId());
        UUID clave = UUID.randomUUID();
        var fallo = accion("/compras/" + compra.compraId() + "/confirmar", clave);
        assertStatus(fallo, 409);
        assertThat(datos(fallo).path("code").asString()).isEqualTo("STOCK_INSUFICIENTE");
        assertThat(consultas.compra(cliente, compra.compraId())).isEqualTo(compra);
        for (UUID id : List.of(oferta1, oferta2, oferta3)) assertThat(catalog.stock.get(id)).isEqualTo(id.equals(sinStock) ? 0 : 10);
        assertThat(catalog.stock.get(reservada)).isEqualTo(9);
        assertThat(referenciaReservas(compra.compraId())).isEqualTo(1);
        assertThat(eventos(compra.compraId())).isEqualTo(antes);
        catalog.stock.put(sinStock, 10);
        var replay = accion("/compras/" + compra.compraId() + "/confirmar", clave);
        assertThat(replay.getResponse().getContentAsString()).isEqualTo(fallo.getResponse().getContentAsString());
        assertStatus(accion("/compras/" + compra.compraId() + "/confirmar", UUID.randomUUID()), 200);
        assertThat(referenciaReservas(compra.compraId())).isEqualTo(4);
    }

    @Test void cancelarOrdenRecalculaTotalYLaUltimaCancelaLaCompraSinBorrarSnapshots() throws Exception {
        var compra = crear(oferta1, oferta2, oferta3);
        var reservada = compra.ordenes().stream().filter(o -> o.estado().equals("pendiente_pago")).findFirst().orElseThrow();
        UUID clave = UUID.randomUUID();
        var primera = accion("/orders/" + reservada.ordenId() + "/cancelar", clave);
        assertStatus(primera, 200);
        assertThat(datos(primera).path("estado").asString()).isEqualTo("cancelado");
        assertThat(datos(primera).path("montoTotal").asLong()).isEqualTo(1200);
        assertThat(catalog.stock.get(oferta3)).isEqualTo(10);
        var parcial = consultas.compra(cliente, compra.compraId());
        assertThat(parcial.montoTotal()).isEqualTo(2700);
        assertThat(parcial.estado()).isEqualTo("revision_requerida");
        // La misma clave tiene espacio independiente en otra ruta.
        assertStatus(accion("/orders/" + revision(compra).ordenId() + "/cancelar", clave), 200);
        var cancelada = consultas.compra(cliente, compra.compraId());
        assertThat(cancelada.estado()).isEqualTo("cancelado"); assertThat(cancelada.montoTotal()).isZero();
        assertThat(cancelada.ordenes()).allMatch(o -> o.estado().equals("cancelado") && !o.items().isEmpty());
        assertThat(referenciaReservas(compra.compraId())).isZero();
        assertStatus(accion("/orders/" + reservada.ordenId() + "/cancelar", UUID.randomUUID()), 409);
    }

    @Test void cancelarCompraLiberaStockYNoPermiteIniciarPagoDespues() throws Exception {
        catalog.stock.put(oferta1, 10);
        var compra = crear(oferta1, oferta2, oferta3);
        var resultado = accion("/compras/" + compra.compraId() + "/cancelar", UUID.randomUUID());
        assertStatus(resultado, 200);
        assertThat(datos(resultado).path("estado").asString()).isEqualTo("cancelado");
        assertThat(datos(resultado).path("montoTotal").asLong()).isZero();
        assertThat(catalog.stock.values()).containsOnly(10);
        assertStatus(iniciarPago(compra.compraId()), 409);
        assertThat(pagos.existsByCompraId(compra.compraId())).isFalse();
        assertThat(eventos(compra.compraId())).isEqualTo(6); // creación y cancelación: compra + dos órdenes.
    }

    @ParameterizedTest @EnumSource(EstadoPago.class)
    void cualquierPagoExistenteImpideLasCuatroAccionesSinModificarlo(EstadoPago estado) throws Exception {
        var compra = crear(oferta1, oferta2, oferta3);
        Pago pago = new Pago(compras.findById(compra.compraId()).orElseThrow(), "SIMULADO", null);
        if (estado != EstadoPago.PENDIENTE) pago.aplicarResultado(estado, "Resultado previo");
        pago = pagos.saveAndFlush(pago);
        var previo = jdbc.queryForMap("SELECT * FROM pagos WHERE id=?", pago.getId());
        var stocks = new HashMap<>(catalog.stock);
        for (String ruta : rutas(compra)) {
            var resultado = accion(ruta, UUID.randomUUID()); assertStatus(resultado, 409);
            assertThat(datos(resultado).path("code").asString()).isEqualTo("ESTADO_INVALIDO");
        }
        assertThat(jdbc.queryForMap("SELECT * FROM pagos WHERE id=?", pago.getId())).isEqualTo(previo);
        assertThat(catalog.stock).isEqualTo(stocks);
    }

    @Test void precioCambioActualizaCotizacionSinReservarYExigeOtraClave() throws Exception {
        var compra = crear(oferta1, oferta2, oferta3);
        catalog.stock.put(oferta1, 10); catalog.precio(oferta1, 2000);
        UUID clave = UUID.randomUUID(); String ruta = "/orders/" + revision(compra).ordenId() + "/confirmar";
        var resultado = accion(ruta, clave); assertStatus(resultado, 409);
        var body = datos(resultado);
        assertThat(body.path("code").asString()).isEqualTo("PRECIO_CAMBIO");
        assertThat(body.path("instance").asString()).isEqualTo(ruta);
        assertThat(body.path("compra").path("montoTotal").asLong()).isEqualTo(4100);
        var cotizada = consultas.compra(cliente, compra.compraId());
        assertThat(cotizada.estado()).isEqualTo("revision_requerida");
        assertThat(cotizada.version()).isEqualTo(2);
        assertThat(cotizada.ordenes().stream().filter(o -> o.estado().equals("pendiente_pago")).findFirst().orElseThrow().version()).isEqualTo(1);
        assertThat(catalog.stock.get(oferta1)).isEqualTo(10); assertThat(catalog.stock.get(oferta2)).isEqualTo(10);
        var replay = accion(ruta, clave);
        assertThat(replay.getResponse().getContentAsString()).isEqualTo(resultado.getResponse().getContentAsString());
        assertThat(replay.getResponse().getHeader("Idempotency-Replayed")).isEqualTo("true");
        assertStatus(accion(ruta, UUID.randomUUID()), 200);
        assertThat(consultas.compra(cliente, compra.compraId()).montoTotal()).isEqualTo(4100);
    }

    @Test void montosFueraDeRangoYOfertaInactivaNoCambianSnapshotsNiReservan() throws Exception {
        var compra = crear(oferta1, oferta2, oferta3);
        String ruta = "/compras/" + compra.compraId() + "/confirmar";
        catalog.precio(oferta1, 2_000_000_000L);
        assertStatus(accion(ruta, UUID.randomUUID()), 400);
        assertThat(consultas.compra(cliente, compra.compraId())).isEqualTo(compra);
        catalog.noDisponibles.add(oferta1);
        var noDisponible = accion(ruta, UUID.randomUUID()); assertStatus(noDisponible, 409);
        assertThat(datos(noDisponible).path("code").asString()).isEqualTo("OFERTA_NO_DISPONIBLE");
        assertThat(consultas.compra(cliente, compra.compraId())).isEqualTo(compra);
    }

    @Test void precioQueCambiaDuranteLaReservaCompensaYDevuelveLaNuevaCotizacion() throws Exception {
        var compra = crear(oferta1, oferta2, oferta3); catalog.stock.put(oferta1, 10);
        catalog.cambiarPrecioAlReservar = oferta1;
        var resultado = accion("/compras/" + compra.compraId() + "/confirmar", UUID.randomUUID());
        assertStatus(resultado, 409);
        assertThat(datos(resultado).path("code").asString()).isEqualTo("PRECIO_CAMBIO");
        assertThat(datos(resultado).path("compra").path("montoTotal").asLong()).isEqualTo(4000);
        assertThat(catalog.stock.get(oferta1)).isEqualTo(10); assertThat(catalog.stock.get(oferta2)).isEqualTo(10);
        assertThat(catalog.stock.get(oferta3)).isEqualTo(9);
    }

    @Test void eventosDeRevisionConservanTrazaYVersionYElReplayNoPublicaOtraVez() throws Exception {
        var compra = crear(oferta1, oferta2, oferta3);
        UUID clave = UUID.randomUUID();
        String ruta = "/orders/" + revision(compra).ordenId() + "/cancelar";
        assertStatus(accion(ruta, clave), 200);
        String trace = jdbc.queryForObject("SELECT trace_id FROM revisiones_compra WHERE ruta=? AND clave=?", String.class, ruta, clave);
        var cuerpos = jdbc.queryForList("SELECT cuerpo FROM order_outbox WHERE cuerpo LIKE ? AND cuerpo LIKE ?", String.class,
                "%" + compra.compraId() + "%", "%" + trace + "%");
        assertThat(cuerpos).hasSize(2);
        var ids = new HashSet<String>();
        for (String cuerpo : cuerpos) {
            var evento = json.readTree(cuerpo);
            assertThat(evento.path("traceId").asString()).isEqualTo(trace);
            assertThat(evento.path("payload").path("version").asLong()).isEqualTo(2);
            assertThat(evento.path("payload").path("clienteId").asString()).isEqualTo(cliente.toString());
            ids.add(evento.path("eventId").asString());
        }
        assertThat(ids).hasSize(2);
        assertStatus(accion(ruta, clave), 200);
        assertThat(jdbc.queryForList("SELECT cuerpo FROM order_outbox WHERE cuerpo LIKE ? AND cuerpo LIKE ?", String.class,
                "%" + compra.compraId() + "%", "%" + trace + "%")).containsExactlyInAnyOrderElementsOf(cuerpos);
    }

    @Test void respuestaDeReservaPerdidaSeRecuperaSinRepetirDescuento() throws Exception {
        var compra = crear(oferta1, oferta2, oferta3); catalog.stock.put(oferta1, 10);
        catalog.perderReserva.set(true);
        UUID clave = UUID.randomUUID(); String ruta = "/compras/" + compra.compraId() + "/confirmar";
        var pendiente = accion(ruta, clave); assertStatus(pendiente, 503);
        assertThat(pendiente.getResponse().getHeader("Retry-After")).isEqualTo("2");
        assertStatus(accion(ruta, UUID.randomUUID()), 409);
        var nuevo = nuevoCoordinador(Clock.systemUTC());
        assertThat(nuevo.ejecutar(cliente, compra.compraId(), false, true, clave).status()).isEqualTo(200);
        assertThat(catalog.stock.values()).containsOnly(9);
        assertThat(referenciaReservas(compra.compraId())).isEqualTo(3);
    }

    @Test void caidaEntreReservaYCommitLocalRepiteLaMismaIntencion() throws Exception {
        var compra = crear(oferta1, oferta2, oferta3); catalog.stock.put(oferta1, 10);
        UUID clave = UUID.randomUUID(); catalog.caerTrasReserva = true;
        assertThatThrownBy(() -> revisiones.ejecutar(cliente, compra.compraId(), false, true, clave)).isInstanceOf(AssertionError.class);
        assertThat(nuevoCoordinador(Clock.systemUTC()).ejecutar(cliente, compra.compraId(), false, true, clave).status()).isEqualTo(200);
        assertThat(catalog.stock.values()).containsOnly(9);
    }

    @Test void compensacionPendienteSeReanudaSinConfundirlaConConfirmacionExitosa() throws Exception {
        var compra = crear(oferta1, oferta2, oferta3);
        var orden = revision(compra);
        UUID primero = orden.items().getFirst().ofertaId(), ultimo = orden.items().getLast().ofertaId();
        catalog.stock.put(primero, 10); catalog.stock.put(ultimo, 0);
        catalog.perderLiberacion.set(true);
        UUID clave = UUID.randomUUID(); String ruta = "/orders/" + orden.ordenId() + "/confirmar";
        assertStatus(accion(ruta, clave), 503);
        var resultado = nuevoCoordinador(Clock.systemUTC()).ejecutar(cliente, orden.ordenId(), true, true, clave);
        assertThat(resultado.status()).isEqualTo(409);
        assertThat(json.readTree(resultado.cuerpo()).path("code").asString()).isEqualTo("STOCK_INSUFICIENTE");
        assertThat(catalog.stock.get(primero)).isEqualTo(10); assertThat(catalog.stock.get(ultimo)).isZero();
        assertThat(catalog.stock.get(oferta3)).isEqualTo(9);
        assertThat(consultas.compra(cliente, compra.compraId())).isEqualTo(compra);
    }

    @Test void cancelacionPendienteBloqueaPagoYWorkerLaRecuperaSinDuplicarLiberacion() throws Exception {
        catalog.stock.put(oferta1, 10);
        var compra = crear(oferta1, oferta2, oferta3);
        catalog.perderLiberacion.set(true);
        UUID clave = UUID.randomUUID(); String ruta = "/compras/" + compra.compraId() + "/cancelar";
        assertStatus(accion(ruta, clave), 503);
        assertThat(consultas.compra(cliente, compra.compraId()).estado()).isEqualTo("pendiente_pago");
        assertStatus(iniciarPago(compra.compraId()), 409);
        assertThat(pagos.existsByCompraId(compra.compraId())).isFalse();
        var worker = new RecuperacionRevision(diario, nuevoCoordinador(Clock.systemUTC()),
                Clock.fixed(Instant.now().plusSeconds(3), ZoneOffset.UTC));
        worker.recuperar();
        assertThat(consultas.compra(cliente, compra.compraId()).estado()).isEqualTo("cancelado");
        assertThat(catalog.stock.values()).containsOnly(10);
        var replay = accion(ruta, clave); assertStatus(replay, 200);
        assertThat(replay.getResponse().getHeader("Idempotency-Replayed")).isEqualTo("true");
        assertThat(jdbc.queryForObject("SELECT revision_pendiente FROM compras WHERE id=?", UUID.class, compra.compraId())).isNull();
    }

    @Test void confirmacionVencidaNoExtiendePlazoYCompensaSoloSuIntento() throws Exception {
        var compra = crear(oferta1, oferta2, oferta3); catalog.stock.put(oferta1, 10);
        catalog.perderReserva.set(true); UUID clave = UUID.randomUUID();
        assertStatus(accion("/compras/" + compra.compraId() + "/confirmar", clave), 503);
        var futuro = nuevoCoordinador(Clock.fixed(compra.reservaExpiraAt().plusSeconds(1), ZoneOffset.UTC));
        var resultado = futuro.ejecutar(cliente, compra.compraId(), false, true, clave);
        assertThat(resultado.status()).isEqualTo(409);
        assertThat(json.readTree(resultado.cuerpo()).path("code").asString()).isEqualTo("RESERVA_VENCIDA");
        assertThat(catalog.stock.get(oferta1)).isEqualTo(10); assertThat(catalog.stock.get(oferta2)).isEqualTo(10);
        assertThat(catalog.stock.get(oferta3)).isEqualTo(9);
        assertThat(consultas.compra(cliente, compra.compraId()).reservaExpiraAt()).isEqualTo(compra.reservaExpiraAt());
    }

    @Test void dosConfirmacionesConcurrentesNoDuplicanReservasNiEventos() throws Exception {
        var compra = crear(oferta1, oferta2, oferta3); catalog.stock.put(oferta1, 10);
        UUID clave = UUID.randomUUID(); String ruta = "/compras/" + compra.compraId() + "/confirmar";
        try (var pool = Executors.newFixedThreadPool(6)) {
            var tareas = new ArrayList<Callable<Integer>>();
            for (int n = 0; n < 6; n++) tareas.add(() -> accion(ruta, clave).getResponse().getStatus());
            for (var future : pool.invokeAll(tareas)) assertThat(future.get()).isIn(200, 409);
        }
        assertStatus(accion(ruta, clave), 200);
        assertThat(catalog.stock.values()).containsOnly(9);
        assertThat(eventos(compra.compraId())).isEqualTo(5);
    }

    @Test void carreraInicioPagoCancelacionTieneUnSoloGanador() throws Exception {
        catalog.stock.put(oferta1, 10);
        var compra = crear(oferta1, oferta2, oferta3);
        UUID clave = UUID.randomUUID();
        try (var pool = Executors.newFixedThreadPool(2)) {
            var inicio = new CountDownLatch(1);
            var cancelar = pool.submit(() -> { inicio.await(); return accion("/compras/" + compra.compraId() + "/cancelar", clave).getResponse().getStatus(); });
            var pagar = pool.submit(() -> { inicio.await(); return iniciarPago(compra.compraId()).getResponse().getStatus(); });
            inicio.countDown(); int cancelacion = cancelar.get(), pago = pagar.get();
            // Ambos pueden observar contención: la intención durable se termina con la misma clave.
            if (cancelacion == 409 && pago == 409) cancelacion = accion("/compras/" + compra.compraId() + "/cancelar", clave).getResponse().getStatus();
            assertThat(cancelacion == 200 && pago == 409 || cancelacion == 409 && pago == 201)
                    .withFailMessage("cancelación=%s, pago=%s", cancelacion, pago).isTrue();
            assertThat(catalog.stock.values()).containsOnly(cancelacion == 200 ? 10 : 9);
        }
    }

    @Test void propietarioAjenoEInexistenteSon404YEstadosTerminalesNoSeReactivan() throws Exception {
        var compra = crear(oferta1, oferta2, oferta3);
        for (String ruta : rutas(compra)) {
            var ajeno = mvc.perform(post(ruta).header("Authorization", bearer(UUID.randomUUID(), "CLIENTE"))
                    .header("Idempotency-Key", UUID.randomUUID())).andReturn();
            assertStatus(ajeno, 404);
        }
        assertStatus(accion("/compras/" + UUID.randomUUID() + "/cancelar", UUID.randomUUID()), 404);
        assertStatus(accion("/orders/" + UUID.randomUUID() + "/confirmar", UUID.randomUUID()), 404);
        assertStatus(accion("/compras/" + compra.compraId() + "/cancelar", UUID.randomUUID()), 200);
        for (String ruta : rutas(compra)) assertStatus(accion(ruta, UUID.randomUUID()), 409);
    }

    @ParameterizedTest @ValueSource(strings = {"CAJERO", "ADMIN_CAFETERIA", "SUPER_ADMIN"})
    void otrosRolesNoPuedenModificarCompras(String rol) throws Exception {
        var compra = crear(oferta1, oferta2, oferta3);
        for (String ruta : rutas(compra)) assertStatus(mvc.perform(post(ruta).header("Authorization", bearer(cliente, rol))
                .header("Idempotency-Key", UUID.randomUUID())).andReturn(), 403);
    }

    @Test void validaAutenticacionClaveUuidYCuerpoAntesDeConsumirIntencion() throws Exception {
        var compra = crear(oferta1, oferta2, oferta3);
        for (String ruta : rutas(compra)) {
            assertStatus(mvc.perform(post(ruta)).andReturn(), 401);
            assertStatus(mvc.perform(post(ruta).header("Authorization", bearer(cliente, "CLIENTE"))).andReturn(), 400);
            assertStatus(mvc.perform(post(ruta).header("Authorization", bearer(cliente, "CLIENTE")).header("Idempotency-Key", "mala")).andReturn(), 400);
            assertStatus(mvc.perform(post(ruta).header("Authorization", bearer(cliente, "CLIENTE")).header("Idempotency-Key", UUID.randomUUID())
                    .contentType(MediaType.APPLICATION_JSON).content("{}")).andReturn(), 400);
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM revisiones_compra WHERE compra_id=?", Integer.class, compra.compraId())).isZero();
    }

    private CompraResponse crear(UUID... ofertas) throws Exception {
        var items = Arrays.stream(ofertas).map(id -> Map.of("ofertaId", id, "cantidad", 1)).toList();
        var respuesta = mvc.perform(post("/compras").header("Authorization", bearer(cliente, "CLIENTE"))
                .header("Idempotency-Key", UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("items", items)))).andReturn();
        assertStatus(respuesta, 201);
        return json.readValue(respuesta.getResponse().getContentAsString(), CompraResponse.class);
    }
    private MvcResult accion(String ruta, UUID clave) throws Exception {
        return mvc.perform(post(ruta).header("Authorization", bearer(cliente, "CLIENTE")).header("Idempotency-Key", clave)).andReturn();
    }
    private MvcResult iniciarPago(UUID compra) throws Exception {
        return mvc.perform(post("/compras/" + compra + "/pago").header("Authorization", bearer(cliente, "CLIENTE"))
                .header("Idempotency-Key", UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON).content("{\"escenario\":\"aprobar\"}")).andReturn();
    }
    private JsonNode datos(MvcResult resultado) throws Exception { return json.readTree(resultado.getResponse().getContentAsString()); }
    private static void assertStatus(MvcResult resultado, int status) throws Exception {
        assertThat(resultado.getResponse().getStatus()).withFailMessage(resultado.getResponse().getContentAsString()).isEqualTo(status);
    }
    private OrdenResponse revision(CompraResponse compra) { return compra.ordenes().stream().filter(o -> o.estado().equals("revision_requerida")).findFirst().orElseThrow(); }
    private List<String> rutas(CompraResponse compra) {
        String c = "/compras/" + compra.compraId(), o = "/orders/" + compra.ordenes().getFirst().ordenId();
        return List.of(c + "/confirmar", c + "/cancelar", o + "/confirmar", o + "/cancelar");
    }
    private int referenciaReservas(UUID compra) {
        return jdbc.queryForObject("SELECT count(*) FROM orden_reservas WHERE orden_id IN (SELECT id FROM ordenes WHERE compra_id=?)", Integer.class, compra);
    }
    private int eventos(UUID compra) {
        return jdbc.queryForObject("SELECT count(*) FROM order_outbox WHERE cuerpo LIKE ?", Integer.class, "%" + compra + "%");
    }
    private RevisionCompraService nuevoCoordinador(Clock clock) {
        return new RevisionCompraService(diario, catalog, consultas, eventos, em, clock, manager);
    }
    private static String bearer(UUID cliente, String rol) {
        return "Bearer " + sign(claims().subject(cliente.toString()).claim("role", rol).build(), KEYS, JWSAlgorithm.RS256);
    }

    @TestConfiguration static class Config { @Bean @Primary CatalogFake catalogFake() { return new CatalogFake(); } }
    static class CatalogFake implements CatalogoCompras {
        final Map<UUID, Oferta> ofertas = new ConcurrentHashMap<>();
        final Map<UUID, Integer> stock = new ConcurrentHashMap<>();
        final Map<String, Reserva> reservas = new ConcurrentHashMap<>();
        final Set<UUID> noDisponibles = ConcurrentHashMap.newKeySet();
        final AtomicBoolean perderReserva = new AtomicBoolean(), perderLiberacion = new AtomicBoolean();
        List<UUID> ultimaCotizacion = List.of();
        boolean caerTrasReserva;
        UUID cambiarPrecioAlReservar;
        void reset() { ofertas.clear(); stock.clear(); reservas.clear(); noDisponibles.clear(); perderReserva.set(false); perderLiberacion.set(false); caerTrasReserva = false; cambiarPrecioAlReservar = null; }
        UUID oferta(UUID campus, UUID cafeteria, long precio, int unidades) {
            UUID id = UUID.randomUUID(); ofertas.put(id, new Oferta(id, UUID.randomUUID(), "Café", cafeteria, "Central", campus, BigDecimal.valueOf(precio)));
            stock.put(id, unidades); return id;
        }
        void precio(UUID id, long precio) { var o = ofertas.get(id); ofertas.put(id, new Oferta(id, o.productoId(), o.productoNombre(), o.cafeteriaId(), o.cafeteriaNombre(), o.campusId(), BigDecimal.valueOf(precio))); }
        public List<Oferta> cotizar(List<UUID> ids) {
            ultimaCotizacion = List.copyOf(ids);
            if (ids.stream().anyMatch(id -> noDisponibles.contains(id) || !ofertas.containsKey(id))) throw new Rechazo("OFERTA_NO_DISPONIBLE");
            return ids.stream().map(ofertas::get).toList();
        }
        public synchronized Reserva reservar(UUID orden, UUID oferta, int cantidad, UUID intento, Instant vence, BigDecimal precio) {
            String key = orden + ":" + oferta + ":" + intento;
            if (reservas.containsKey(key)) return reservas.get(key);
            if (oferta.equals(cambiarPrecioAlReservar)) { precio(oferta, ofertas.get(oferta).precioUnitario().longValueExact() + 100); cambiarPrecioAlReservar = null; }
            if (noDisponibles.contains(oferta) || ofertas.get(oferta).precioUnitario().compareTo(precio) != 0) throw new Rechazo("OFERTA_NO_DISPONIBLE");
            if (stock.get(oferta) < cantidad) throw new Rechazo("STOCK_NO_DISPONIBLE");
            stock.compute(oferta, (id, n) -> n - cantidad);
            var reserva = new Reserva(UUID.randomUUID(), orden, oferta, intento, cantidad, "RESERVED", Instant.now(), vence); reservas.put(key, reserva);
            if (caerTrasReserva) { caerTrasReserva = false; throw new AssertionError("caída antes del commit local"); }
            if (perderReserva.getAndSet(false)) throw new NoDisponible();
            return reserva;
        }
        public synchronized void liberar(UUID id) {
            for (var entry : reservas.entrySet()) {
                Reserva r = entry.getValue();
                if (r.reservationId().equals(id) && r.status().equals("RESERVED")) {
                    stock.compute(r.offerId(), (oferta, n) -> n + r.quantity());
                    entry.setValue(new Reserva(id, r.orderId(), r.offerId(), r.attemptId(), r.quantity(), "RELEASED", r.reservedAt(), r.expiresAt()));
                }
            }
            if (perderLiberacion.getAndSet(false)) throw new NoDisponible();
        }
    }
}
