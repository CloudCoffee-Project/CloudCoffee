package cl.cloudcoffee.order_service.creacion;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import com.nimbusds.jose.JWSAlgorithm;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
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

/** HTTP con JWT firmado, transacciones y migraciones reales; el puerto Catalog simula fallos de red. */
@SpringBootTest(properties = {"management.tracing.enabled=false", "cloudcoffee.creation.recovery-enabled=false",
        "cloudcoffee.creation.publish-enabled=false"})
@AutoConfigureMockMvc
class CreacionCompraIntegrationTests extends JwtTestSupport {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired JsonMapper json;
    @Autowired CatalogFake catalog;
    @Autowired DiarioCreacion diario;
    @Autowired PlatformTransactionManager manager;
    final UUID cliente = UUID.randomUUID();
    UUID oferta1, oferta2, oferta3, clave;

    @BeforeEach void ofertas() {
        catalog.reset();
        UUID campus = UUID.randomUUID(), cafeteria = UUID.randomUUID();
        oferta1 = catalog.oferta(campus, cafeteria, 1800, 10);
        oferta2 = catalog.oferta(campus, cafeteria, 900, 10);
        oferta3 = catalog.oferta(campus, UUID.randomUUID(), 1200, 10);
        clave = UUID.randomUUID();
    }

    @Test void creaDosOrdenesSnapshotsTotalesYEventosSinAceptarPreciosDelCliente() throws Exception {
        var resultado = crear(clave, body(oferta1, 2, oferta3, 1));
        assertThat(resultado.getResponse().getStatus()).isEqualTo(201);
        var compra = respuesta(resultado);
        assertThat(compra.path("clienteId").asString()).isEqualTo(cliente.toString());
        assertThat(compra.path("montoTotal").asLong()).isEqualTo(4800);
        assertThat(compra.path("estado").asString()).isEqualTo("pendiente_pago");
        assertThat(compra.path("ordenes").size()).isEqualTo(2);
        assertThat(compra.path("pago").isNull()).isTrue();
        assertThat(Instant.parse(compra.path("reservaExpiraAt").asString()))
                .isEqualTo(Instant.parse(compra.path("creadoAt").asString()).plusSeconds(900));
        assertThat(resultado.getResponse().getHeader("Location")).isEqualTo("/v1/compras/" + compra.path("compraId").asString());
        assertThat(resultado.getResponse().getHeader("Cache-Control")).isEqualTo("no-store");
        assertThat(catalog.stock.get(oferta1)).isEqualTo(8);
        assertThat(catalog.stock.get(oferta3)).isEqualTo(9);
        assertThat(count("orden_reservas", "orden_id IN (SELECT id FROM ordenes WHERE compra_id='" + compra.path("compraId").asString() + "')")).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM order_outbox WHERE cuerpo LIKE ?", Integer.class,
                "%" + compra.path("compraId").asString() + "%")).isEqualTo(3);
        mvc.perform(get("/compras/" + compra.path("compraId").asString()).header("Authorization", bearer(cliente, "CLIENTE")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.montoTotal").value(4800))
                .andExpect(jsonPath("$.creadoAt").value(compra.path("creadoAt").asString()))
                .andExpect(jsonPath("$.reservaExpiraAt").value(compra.path("reservaExpiraAt").asString()))
                .andExpect(jsonPath("$.ordenes[0].reservaExpiraAt").value(compra.path("reservaExpiraAt").asString()));
        mvc.perform(get("/compras/" + compra.path("compraId").asString()).header("Authorization", bearer(UUID.randomUUID(), "CLIENTE")))
                .andExpect(status().isNotFound());
    }

    @Test void faltaStockCompensaTodaLaCafeteriaYConservaLaOtra() throws Exception {
        // Ordenar IDs permite asegurar que una reserva exitosa preceda al ítem sin stock.
        UUID primera = oferta1.toString().compareTo(oferta2.toString()) < 0 ? oferta1 : oferta2;
        UUID segunda = primera.equals(oferta1) ? oferta2 : oferta1;
        catalog.stock.put(segunda, 0);
        var resultado = crear(clave, body(primera, 1, segunda, 1, oferta3, 2));
        assertThat(resultado.getResponse().getStatus()).isEqualTo(201);
        var compra = respuesta(resultado);
        assertThat(compra.path("estado").asString()).isEqualTo("revision_requerida");
        assertThat(catalog.stock.get(primera)).isEqualTo(10);
        assertThat(catalog.stock.get(oferta3)).isEqualTo(8);
        List<String> estados = new ArrayList<>();
        compra.path("ordenes").forEach(o -> estados.add(o.path("estado").asString()));
        assertThat(estados).containsExactlyInAnyOrder("revision_requerida", "pendiente_pago");
        assertThat(catalog.reservas.values().stream().filter(r -> r.status().equals("RELEASED")).count()).isEqualTo(1);
    }

    @Test void replayEsElSnapshotOriginalAunqueCambienCatalogoYCompraYNormalizaItems() throws Exception {
        String primero = crear(clave, body(oferta1, 2, oferta3, 1)).getResponse().getContentAsString();
        JsonNode compra = json.readTree(primero);
        UUID compraId = UUID.fromString(compra.path("compraId").asString());
        jdbc.update("UPDATE compras SET estado='REVISION_REQUERIDA', version=version+1 WHERE id=?", compraId);
        catalog.ofertas.clear();
        var replay = crear(clave, body(oferta3, 1, oferta1, 2));
        assertThat(replay.getResponse().getStatus()).isEqualTo(201);
        assertThat(replay.getResponse().getContentAsString()).isEqualTo(primero);
        assertThat(replay.getResponse().getHeader("Idempotency-Replayed")).isEqualTo("true");
        assertThat(count("compras", "usuario_id='" + cliente + "'")).isEqualTo(1);
        assertThat(catalog.stock.get(oferta1)).isEqualTo(8);
    }

    @Test void otraCargaConMismaClaveEsConflictoYOtroUsuarioTieneSuPropioEspacio() throws Exception {
        crear(clave, body(oferta1, 1));
        var conflicto = crear(clave, body(oferta1, 2));
        assertThat(conflicto.getResponse().getStatus()).isEqualTo(409);
        assertThat(respuesta(conflicto).path("code").asString()).isEqualTo("IDEMPOTENCY_CONFLICT");
        mvc.perform(post("/compras").header("Authorization", bearer(UUID.randomUUID(), "CLIENTE"))
                        .header("Idempotency-Key", clave).contentType(MediaType.APPLICATION_JSON).content(body(oferta1, 1)))
                .andExpect(status().isCreated());
        assertThat(catalog.stock.get(oferta1)).isEqualTo(8);
    }

    @Test void respuestaDeReservaPerdidaReanudaConOtroCoordinadorSinDescontarOtraVez() throws Exception {
        catalog.perderRespuestaReserva.set(true);
        var fallo = crear(clave, body(oferta1, 2));
        assertThat(fallo.getResponse().getStatus()).isEqualTo(503);
        assertThat(fallo.getResponse().getHeader("Retry-After")).isEqualTo("2");
        assertThat(count("compras", "usuario_id='" + cliente + "'")).isZero();
        assertThat(catalog.stock.get(oferta1)).isEqualTo(8);
        var nuevo = new CreacionCompraService(diario, catalog, manager, java.time.Clock.systemUTC());
        var respuesta = nuevo.crear(cliente, clave, json.readTree(body(oferta1, 2)));
        assertThat(respuesta.status()).isEqualTo(201);
        assertThat(catalog.stock.get(oferta1)).isEqualTo(8);
        assertThat(catalog.reservas).hasSize(1);
        assertThat(count("compras", "usuario_id='" + cliente + "'")).isEqualTo(1);
    }

    @Test void compensacionConRespuestaPerdidaSeRecuperaSinDuplicarLiberacion() throws Exception {
        UUID primera = oferta1.toString().compareTo(oferta2.toString()) < 0 ? oferta1 : oferta2;
        UUID segunda = primera.equals(oferta1) ? oferta2 : oferta1;
        catalog.stock.put(segunda, 0);
        catalog.perderRespuestaLiberacion.set(true);
        assertThat(crear(clave, body(primera, 1, segunda, 1)).getResponse().getStatus()).isEqualTo(503);
        assertThat(catalog.stock.get(primera)).isEqualTo(10);
        assertThat(crear(clave, body(primera, 1, segunda, 1)).getResponse().getStatus()).isEqualTo(201);
        assertThat(catalog.stock.get(primera)).isEqualTo(10);
        assertThat(catalog.liberaciones).isEqualTo(1);
    }

    @Test void vencimientoComunNoSeExtiendeAlReanudarYCompensaLaReservaIncierta() throws Exception {
        catalog.perderRespuestaReserva.set(true);
        crear(clave, body(oferta1, 2));
        Instant futuro = Instant.now().plusSeconds(901);
        var nuevo = new CreacionCompraService(diario, catalog, manager,
                java.time.Clock.fixed(futuro, java.time.ZoneOffset.UTC));
        var respuesta = nuevo.crear(cliente, clave, json.readTree(body(oferta1, 2)));
        assertThat(respuesta.status()).isEqualTo(409);
        assertThat(json.readTree(respuesta.cuerpo()).path("code").asString()).isEqualTo("RESERVA_VENCIDA");
        assertThat(catalog.stock.get(oferta1)).isEqualTo(10);
        assertThat(count("compras", "usuario_id='" + cliente + "'")).isZero();
    }

    @Test void cambioDeOfertaMientrasSeReservaCompensaTambienLasOtrasCafeterias() throws Exception {
        UUID primera = oferta1.toString().compareTo(oferta2.toString()) < 0 ? oferta1 : oferta2;
        UUID segunda = primera.equals(oferta1) ? oferta2 : oferta1;
        catalog.rechazarAlReservar = segunda;
        var resultado = crear(clave, body(primera, 1, segunda, 1, oferta3, 1));
        assertThat(resultado.getResponse().getStatus()).isEqualTo(409);
        assertThat(respuesta(resultado).path("code").asString()).isEqualTo("OFERTA_NO_DISPONIBLE");
        assertThat(catalog.stock.get(primera)).isEqualTo(10);
        assertThat(catalog.stock.get(oferta3)).isEqualTo(10);
        assertThat(count("compras", "usuario_id='" + cliente + "'")).isZero();
    }

    @Test void caidaTrasReservarAntesDelCommitRepiteLaMismaIntencion() throws Exception {
        catalog.caerTrasReserva = true;
        var coordinator = new CreacionCompraService(diario, catalog, manager, java.time.Clock.systemUTC());
        assertThatThrownBy(() -> coordinator.crear(cliente, clave, json.readTree(body(oferta1, 2))))
                .isInstanceOf(AssertionError.class);
        assertThat(catalog.stock.get(oferta1)).isEqualTo(8);
        var reiniciado = new CreacionCompraService(diario, catalog, manager, java.time.Clock.systemUTC());
        assertThat(reiniciado.crear(cliente, clave, json.readTree(body(oferta1, 2))).status()).isEqualTo(201);
        assertThat(catalog.stock.get(oferta1)).isEqualTo(8);
        assertThat(catalog.reservas).hasSize(1);
    }

    @Test void eventosDurablesSeReintentanConMismoIdYNoImpidenCrearCompra() throws Exception {
        jdbc.update("UPDATE order_outbox SET publicado=TRUE");
        var compra = respuesta(crear(clave, body(oferta1, 1)));
        var ids = jdbc.queryForList("SELECT event_id FROM order_outbox WHERE publicado=FALSE", UUID.class);
        assertThat(ids).hasSize(2);
        var rabbit = mock(org.springframework.amqp.rabbit.core.RabbitTemplate.class);
        doThrow(new org.springframework.amqp.AmqpConnectException(new java.net.ConnectException("broker caído")))
                .when(rabbit).send(eq("cloudcoffee.events"), anyString(), any(org.springframework.amqp.core.Message.class),
                        any(org.springframework.amqp.rabbit.connection.CorrelationData.class));
        var publisher = new OrderEventOutbox(jdbc, rabbit, manager);
        publisher.publicar();
        assertThat(jdbc.queryForList("SELECT event_id FROM order_outbox WHERE publicado=FALSE", UUID.class))
                .containsExactlyInAnyOrderElementsOf(ids);
        doAnswer(invocation -> {
            var message = invocation.getArgument(2, org.springframework.amqp.core.Message.class);
            var correlation = invocation.getArgument(3, org.springframework.amqp.rabbit.connection.CorrelationData.class);
            assertThat(json.readTree(message.getBody()).path("compraId").isMissingNode()).isTrue();
            assertThat(json.readTree(message.getBody()).path("payload").path("compraId").asString())
                    .isEqualTo(compra.path("compraId").asString());
            assertThat(UUID.fromString(correlation.getId())).isIn(ids);
            correlation.getFuture().complete(new org.springframework.amqp.rabbit.connection.CorrelationData.Confirm(true, null));
            return null;
        }).when(rabbit).send(eq("cloudcoffee.events"), anyString(), any(org.springframework.amqp.core.Message.class),
                any(org.springframework.amqp.rabbit.connection.CorrelationData.class));
        publisher.publicar();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM order_outbox WHERE publicado=FALSE", Integer.class)).isZero();
    }

    @Test void solicitudesConcurrentesNoDuplicanCompraNiReservas() throws Exception {
        try (var executor = Executors.newFixedThreadPool(6)) {
            var tareas = new ArrayList<Callable<Integer>>();
            for (int n = 0; n < 6; n++) tareas.add(() -> crear(clave, body(oferta1, 2)).getResponse().getStatus());
            for (var future : executor.invokeAll(tareas)) assertThat(future.get()).isIn(201, 409);
        }
        assertThat(crear(clave, body(oferta1, 2)).getResponse().getStatus()).isEqualTo(201);
        assertThat(count("compras", "usuario_id='" + cliente + "'")).isEqualTo(1);
        assertThat(catalog.reservas).hasSize(1);
        assertThat(catalog.stock.get(oferta1)).isEqualTo(8);
    }

    @Test void errorDefinitivoDeOfertaSeConservaSinCrearCompra() throws Exception {
        catalog.ofertas.remove(oferta1);
        var fallo = crear(clave, body(oferta1, 1));
        assertThat(fallo.getResponse().getStatus()).isEqualTo(409);
        catalog.ofertas.put(oferta1, catalog.ofertas.get(oferta2));
        var replay = crear(clave, body(oferta1, 1));
        assertThat(replay.getResponse().getContentAsString()).isEqualTo(fallo.getResponse().getContentAsString());
        assertThat(catalog.reservas).isEmpty();
    }

    @Test void campusDistintosYMontosFraccionariosOExcesivosNoReservan() throws Exception {
        var o = catalog.ofertas.get(oferta1);
        catalog.ofertas.put(oferta1, new CatalogoCompras.Oferta(o.ofertaId(), o.productoId(), o.productoNombre(),
                o.cafeteriaId(), o.cafeteriaNombre(), UUID.randomUUID(), o.precioUnitario()));
        assertThat(crear(clave, body(oferta1, 1, oferta3, 1)).getResponse().getStatus()).isEqualTo(409);
        for (String precio : List.of("1.5", "2000000001", "-1")) {
            catalog.ofertas.put(oferta2, new CatalogoCompras.Oferta(oferta2, o.productoId(), "Café", o.cafeteriaId(),
                    "Central", o.campusId(), new BigDecimal(precio)));
            assertThat(crear(UUID.randomUUID(), body(oferta2, 1)).getResponse().getStatus()).isEqualTo(400);
        }
        assertThat(catalog.reservas).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"items\":[]}", "{\"items\":null}",
            "{\"items\":[null]}", "{\"items\":[{\"ofertaId\":\"INVALID\",\"cantidad\":1}]}",
            "{\"items\":[],\"clienteId\":\"ajeno\"}"})
    void cuerpoInvalidoNoConsumeClave(String cuerpo) throws Exception {
        assertThat(crear(clave, cuerpo).getResponse().getStatus()).isEqualTo(400);
        assertThat(count("creacion_compras", "usuario_id='" + cliente + "'")).isZero();
        assertThat(crear(clave, body(oferta1, 1)).getResponse().getStatus()).isEqualTo(201);
    }

    @Test void rechazaDuplicadosCantidadesExtrasYMasDeCienOfertas() throws Exception {
        for (String invalido : List.of(body(oferta1, 1, oferta1, 1), body(oferta1, 0), body(oferta1, 101),
                "{\"items\":[{\"ofertaId\":\"" + oferta1 + "\",\"cantidad\":1.5}]}",
                body(oferta1, 1).replace("\"cantidad\":1", "\"cantidad\":1,\"precio\":1"),
                body(oferta1, 1).replace("{\"items\":", "{\"estado\":\"pagado\",\"items\":"))) {
            assertThat(crear(clave, invalido).getResponse().getStatus()).isEqualTo(400);
        }
        var muchos = new ArrayList<Map<String, Object>>();
        for (int n = 0; n < 101; n++) muchos.add(Map.of("ofertaId", UUID.randomUUID(), "cantidad", 1));
        assertThat(crear(clave, json.writeValueAsString(Map.of("items", muchos))).getResponse().getStatus()).isEqualTo(400);
        assertThat(catalog.reservas).isEmpty();
    }

    @Test void jwtClaveYRolSonObligatorios() throws Exception {
        mvc.perform(post("/compras").contentType(MediaType.APPLICATION_JSON).content(body(oferta1, 1)))
                .andExpect(status().isUnauthorized());
        for (String rol : List.of("CAJERO", "ADMIN_CAFETERIA", "SUPER_ADMIN"))
            mvc.perform(post("/compras").header("Authorization", bearer(cliente, rol)).header("Idempotency-Key", clave)
                    .contentType(MediaType.APPLICATION_JSON).content(body(oferta1, 1))).andExpect(status().isForbidden());
        for (String key : List.of("", "invalida", "1-1-1-1-1"))
            mvc.perform(post("/compras").header("Authorization", bearer(cliente, "CLIENTE")).header("Idempotency-Key", key)
                    .contentType(MediaType.APPLICATION_JSON).content(body(oferta1, 1))).andExpect(status().isBadRequest());
        mvc.perform(post("/compras").header("Authorization", bearer(cliente, "CLIENTE"))
                .contentType(MediaType.APPLICATION_JSON).content(body(oferta1, 1))).andExpect(status().isBadRequest());
        assertThat(catalog.reservas).isEmpty();
    }

    private MvcResult crear(UUID key, String body) throws Exception {
        return mvc.perform(post("/compras").header("Authorization", bearer(cliente, "CLIENTE"))
                .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON).content(body)).andReturn();
    }
    private JsonNode respuesta(MvcResult result) throws Exception { return json.readTree(result.getResponse().getContentAsString()); }
    private String body(Object... pares) {
        List<Map<String, Object>> items = new ArrayList<>();
        for (int i = 0; i < pares.length; i += 2) items.add(Map.of("ofertaId", pares[i], "cantidad", pares[i + 1]));
        return json.writeValueAsString(Map.of("items", items));
    }
    private int count(String tabla, String filtro) { return jdbc.queryForObject("SELECT count(*) FROM " + tabla + " WHERE " + filtro, Integer.class); }
    private static String bearer(UUID user, String rol) {
        return "Bearer " + sign(claims().subject(user.toString()).claim("role", rol).build(), KEYS, JWSAlgorithm.RS256);
    }

    @TestConfiguration static class Config {
        @Bean @Primary CatalogFake catalogFake() { return new CatalogFake(); }
    }
    static class CatalogFake implements CatalogoCompras {
        final Map<UUID, Oferta> ofertas = new ConcurrentHashMap<>();
        final Map<UUID, Integer> stock = new ConcurrentHashMap<>();
        final Map<String, Reserva> reservas = new ConcurrentHashMap<>();
        final AtomicBoolean perderRespuestaReserva = new AtomicBoolean(), perderRespuestaLiberacion = new AtomicBoolean();
        int liberaciones;
        UUID rechazarAlReservar;
        boolean caerTrasReserva;
        void reset() { ofertas.clear(); stock.clear(); reservas.clear(); perderRespuestaReserva.set(false); perderRespuestaLiberacion.set(false); liberaciones = 0; rechazarAlReservar = null; caerTrasReserva = false; }
        UUID oferta(UUID campus, UUID cafeteria, long precio, int cantidad) {
            UUID id = UUID.randomUUID();
            ofertas.put(id, new Oferta(id, UUID.randomUUID(), "Café histórico", cafeteria, "Central", campus, BigDecimal.valueOf(precio)));
            stock.put(id, cantidad); return id;
        }
        public List<Oferta> cotizar(List<UUID> ids) {
            if (ids.stream().anyMatch(id -> !ofertas.containsKey(id))) throw new Rechazo("OFERTA_NO_DISPONIBLE");
            return ids.stream().map(ofertas::get).toList();
        }
        public synchronized Reserva reservar(UUID orden, UUID oferta, int cantidad, UUID intento, Instant vence, BigDecimal precio) {
            String key = orden + ":" + oferta + ":" + intento;
            if (reservas.containsKey(key)) return reservas.get(key);
            if (oferta.equals(rechazarAlReservar)) throw new Rechazo("OFERTA_NO_DISPONIBLE");
            if (stock.get(oferta) < cantidad) throw new Rechazo("STOCK_NO_DISPONIBLE");
            stock.compute(oferta, (id, n) -> n - cantidad);
            Reserva reserva = new Reserva(UUID.randomUUID(), orden, oferta, intento, cantidad, "RESERVED", Instant.now(), vence);
            reservas.put(key, reserva);
            if (caerTrasReserva) { caerTrasReserva = false; throw new AssertionError("caída de proceso simulada"); }
            if (perderRespuestaReserva.getAndSet(false)) throw new NoDisponible();
            return reserva;
        }
        public synchronized void liberar(UUID id) {
            for (var entry : reservas.entrySet()) {
                Reserva r = entry.getValue();
                if (r.reservationId().equals(id) && r.status().equals("RESERVED")) {
                    stock.compute(r.offerId(), (oferta, n) -> n + r.quantity()); liberaciones++;
                    entry.setValue(new Reserva(id, r.orderId(), r.offerId(), r.attemptId(), r.quantity(), "RELEASED", r.reservedAt(), r.expiresAt()));
                }
            }
            if (perderRespuestaLiberacion.getAndSet(false)) throw new NoDisponible();
        }
    }
}
