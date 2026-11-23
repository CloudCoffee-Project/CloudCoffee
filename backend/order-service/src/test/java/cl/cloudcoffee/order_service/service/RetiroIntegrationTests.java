package cl.cloudcoffee.order_service.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import cl.cloudcoffee.order_service.dto.CompraResponse;
import cl.cloudcoffee.order_service.messaging.OrderEventJournal;
import cl.cloudcoffee.security.AsignacionNoVerificableException;
import cl.cloudcoffee.security.AsignacionesCafeteria;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import com.nimbusds.jose.JWSAlgorithm;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Pago real de Order con el puerto Catalog existente; JWT firmado y base con Flyway. */
@SpringBootTest(properties = {"management.tracing.enabled=false", "cloudcoffee.creation.recovery-enabled=false",
        "cloudcoffee.revision.recovery-enabled=false",
        "cloudcoffee.retiro.encryption-key=" + CredencialesRetiroTest.KEY})
@AutoConfigureMockMvc
@Import(ResultadoPagoIntegrationTests.Config.class)
class RetiroIntegrationTests extends JwtTestSupport {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired JsonMapper json;
    @Autowired ConsultaComprasService consultas;
    @Autowired ResultadoPagoIntegrationTests.CatalogFake catalog;
    @MockitoBean AsignacionesCafeteria asignaciones;
    @MockitoBean Clock clock;
    @MockitoSpyBean OrderEventJournal events;
    final UUID comprador = UUID.randomUUID();
    final UUID cajero = UUID.randomUUID();
    final UUID otroCajero = UUID.randomUUID();
    final UUID central = UUID.randomUUID();
    final UUID norte = UUID.randomUUID();
    static final Instant AHORA = Instant.parse("2026-11-23T16:00:00Z");
    UUID oferta;

    @BeforeEach
    void prepararDatos() {
        when(clock.instant()).thenReturn(AHORA);
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);
        when(asignaciones.cafeteriaDe(any())).thenReturn(Optional.empty());
        when(asignaciones.cafeteriaDe(cajero)).thenReturn(Optional.of(central));
        when(asignaciones.cafeteriaDe(otroCajero)).thenReturn(Optional.of(norte));
        catalog.reset();
        oferta = catalog.oferta(UUID.randomUUID(), central, 1800, 10);
    }

    @Test
    void preparaOrdenPagadaConAuditoriaUnSoloEventoYCredencialEstable() throws Exception {
        var compra = comprar("aprobar");
        var orden = compra.ordenes().getFirst();
        UUID id = orden.ordenId();
        Instant limite = AHORA.plus(Duration.ofHours(2));
        assertThat(orden.retiroHasta()).isEqualTo(limite);
        int eventosAntes = eventos(id);
        UUID clave = UUID.randomUUID();
        qr(id, comprador, "CLIENTE").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ESTADO_INVALIDO"));

        MvcResult preparada = preparar(id, clave).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.estado").value("listo_para_retiro"))
                .andExpect(jsonPath("$.version").value(orden.version() + 1))
                .andExpect(jsonPath("$.retiroHasta").value(limite.toString())).andReturn();
        String codigo = cuerpo(qr(id, comprador, "CLIENTE").andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store")).andReturn()).path("codigo").asString();
        assertThat(codigo).matches("[A-Za-z0-9_-]{43}");
        assertThat(preparada.getResponse().getContentAsString()).doesNotContain(codigo);
        assertThat(catalog.stock.get(oferta)).isEqualTo(9);
        assertThat(catalog.estados()).containsOnly("CONFIRMED");
        assertThat(jdbc.queryForObject("SELECT preparado_por FROM orden_retiros WHERE orden_id=?", UUID.class, id)).isEqualTo(cajero);
        assertThat(jdbc.queryForObject("SELECT preparado_at FROM orden_retiros WHERE orden_id=?",
                java.time.LocalDateTime.class, id)).isEqualTo(java.time.LocalDateTime.ofInstant(AHORA, ZoneOffset.UTC));
        assertThat(eventos(id)).isEqualTo(eventosAntes + 1);
        assertThat(jdbc.queryForObject("SELECT cuerpo FROM order_outbox WHERE event_type='order.orden.estado-cambiado.v1' "
                + "AND cuerpo LIKE ? AND cuerpo LIKE '%listo_para_retiro%'", String.class, "%" + id + "%"))
                .contains("listo_para_retiro", "eventId", "traceId").doesNotContain(codigo);
        String cifrado = jdbc.queryForObject("SELECT codigo_cifrado FROM orden_retiros WHERE orden_id=?", String.class, id);
        assertThat(cifrado).doesNotContain(codigo);
        assertThat(new CredencialesRetiro(CredencialesRetiroTest.KEY).recuperar(id, cifrado)).isEqualTo(codigo);

        when(clock.instant()).thenReturn(AHORA.plusSeconds(60));
        qr(id, comprador, "CLIENTE").andExpect(jsonPath("$.codigo").value(codigo))
                .andExpect(jsonPath("$.expiraAt").value(limite.toString()));
        qr(id, cajero, "CAJERO").andExpect(status().isOk()).andExpect(jsonPath("$.codigo").value(codigo));
        preparar(id, clave).andExpect(status().isOk()).andExpect(header().string("Idempotency-Replayed", "true"))
                .andExpect(content().string(preparada.getResponse().getContentAsString()));
        preparar(id, UUID.randomUUID()).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("ESTADO_INVALIDO"));
        assertThat(eventos(id)).isEqualTo(eventosAntes + 1);
    }

    @Test
    void venceEnElLimiteExactoSinExtenderPlazoYReplayNoReemiteCodigo() throws Exception {
        UUID id = comprar("aprobar").ordenes().getFirst().ordenId();
        UUID clave = UUID.randomUUID();
        String respuesta = preparar(id, clave).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        Instant limite = AHORA.plus(Duration.ofHours(2));
        when(clock.instant()).thenReturn(limite.minusNanos(1));
        qr(id, comprador, "CLIENTE").andExpect(status().isOk());
        when(clock.instant()).thenReturn(limite);
        qr(id, comprador, "CLIENTE").andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("QR_VENCIDO"));
        preparar(id, clave).andExpect(status().isOk()).andExpect(content().string(respuesta));

        UUID sinPreparar = comprar("aprobar").ordenes().getFirst().ordenId();
        when(clock.instant()).thenReturn(limite.plus(Duration.ofHours(2)));
        preparar(sinPreparar, UUID.randomUUID()).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("QR_VENCIDO"));
        assertThat(credenciales(sinPreparar)).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"REVISION_REQUERIDA", "PENDIENTE_PAGO", "CANCELADO", "ENTREGADO",
            "NO_RETIRADO_PENDIENTE_REVISION", "NO_RETIRADO_FINAL"})
    void estadosIncompatiblesNoEmitenNiDevuelvenCredenciales(String estado) throws Exception {
        UUID id = comprar("aprobar").ordenes().getFirst().ordenId();
        jdbc.update("UPDATE ordenes SET estado=? WHERE id=?", estado, id);
        int antes = eventos(id);
        preparar(id, UUID.randomUUID()).andExpect(status().isConflict());
        qr(id, comprador, "CLIENTE").andExpect(status().isConflict());
        assertThat(credenciales(id)).isZero();
        assertThat(eventos(id)).isEqualTo(antes);
    }

    @ParameterizedTest
    @ValueSource(strings = {"PENDIENTE", "RECHAZADO", "REQUIERE_CONCILIACION"})
    void verificaPagoCanonicoAlPrepararYConsultar(String estadoPago) throws Exception {
        var compra = comprar("aprobar");
        UUID id = compra.ordenes().getFirst().ordenId();
        jdbc.update("UPDATE pagos SET estado=? WHERE compra_id=?", estadoPago, compra.compraId());
        preparar(id, UUID.randomUUID()).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("ESTADO_INVALIDO"));
        assertThat(credenciales(id)).isZero();
        jdbc.update("UPDATE pagos SET estado='APROBADO' WHERE compra_id=?", compra.compraId());
        preparar(id, UUID.randomUUID()).andExpect(status().isOk());
        jdbc.update("UPDATE pagos SET estado=? WHERE compra_id=?", estadoPago, compra.compraId());
        qr(id, comprador, "CLIENTE").andExpect(status().isConflict());
    }

    @Test
    void sinConfirmacionDeStockOPagoAusenteNoEmiteQr() throws Exception {
        var pendiente = comprar("pendiente");
        UUID idPendiente = pendiente.ordenes().getFirst().ordenId();
        preparar(idPendiente, UUID.randomUUID()).andExpect(status().isConflict());
        assertThat(catalog.estados()).containsOnly("RESERVED");
        var pagada = comprar("aprobar");
        UUID id = pagada.ordenes().getFirst().ordenId();
        jdbc.update("DELETE FROM orden_reservas WHERE orden_id=?", id);
        preparar(id, UUID.randomUUID()).andExpect(status().isConflict());
        assertThat(credenciales(id)).isZero();
        var sinPago = comprar("aprobar");
        UUID idSinPago = sinPago.ordenes().getFirst().ordenId();
        jdbc.update("DELETE FROM pagos WHERE compra_id=?", sinPago.compraId());
        preparar(idSinPago, UUID.randomUUID()).andExpect(status().isConflict());
        assertThat(credenciales(idSinPago)).isZero();
    }

    @Test
    void elCodigoNoReemplazaIdentidadNiPropiedadYCadaOrdenTieneSuCredencial() throws Exception {
        UUID primera = comprar("aprobar").ordenes().getFirst().ordenId();
        UUID segunda = comprar("aprobar").ordenes().getFirst().ordenId();
        preparar(primera, UUID.randomUUID()).andExpect(status().isOk());
        preparar(segunda, UUID.randomUUID()).andExpect(status().isOk());
        String codigo = cuerpo(qr(primera, comprador, "CLIENTE").andReturn()).path("codigo").asString();
        assertThat(cuerpo(qr(segunda, comprador, "CLIENTE").andReturn()).path("codigo").asString()).isNotEqualTo(codigo);
        mvc.perform(get("/orders/" + segunda + "/qr").param("codigo", codigo)
                .header("Authorization", bearer(UUID.randomUUID(), "CLIENTE", null))).andExpect(status().isNotFound());
        mvc.perform(get("/orders/" + primera + "/qr").header("Authorization", "Bearer " + codigo))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void asignacionPersistidaAutorizaAntesDeRevelarReplayYRechazaOtraCafeteria() throws Exception {
        UUID id = comprar("aprobar").ordenes().getFirst().ordenId();
        UUID clave = UUID.randomUUID();
        preparar(id, clave).andExpect(status().isOk());
        qr(id, otroCajero, "CAJERO").andExpect(status().isNotFound());
        mvc.perform(post("/orders/" + id + "/listo").header("Idempotency-Key", UUID.randomUUID())
                .header("Authorization", bearer(otroCajero, "CAJERO", central))).andExpect(status().isNotFound());
        when(asignaciones.cafeteriaDe(cajero)).thenReturn(Optional.of(norte));
        preparar(id, clave).andExpect(status().isNotFound());
        when(asignaciones.cafeteriaDe(cajero)).thenReturn(Optional.empty());
        preparar(id, clave).andExpect(status().isForbidden());
        qr(id, cajero, "CAJERO").andExpect(status().isForbidden());
        when(asignaciones.cafeteriaDe(cajero)).thenThrow(new AsignacionNoVerificableException("Auth no disponible", null));
        preparar(id, clave).andExpect(status().isForbidden());
    }

    @ParameterizedTest
    @ValueSource(strings = {"CLIENTE", "ADMIN_CAFETERIA", "SUPER_ADMIN"})
    void soloCajeroPreparaYLosRolesAdministrativosNoConsultanElQr(String rol) throws Exception {
        UUID id = comprar("aprobar").ordenes().getFirst().ordenId();
        mvc.perform(post("/orders/" + id + "/listo").header("Idempotency-Key", UUID.randomUUID())
                .header("Authorization", bearer(comprador, rol, "CLIENTE".equals(rol) ? null : central)))
                .andExpect(status().isForbidden());
        if (!"CLIENTE".equals(rol)) qr(id, cajero, rol).andExpect(status().isForbidden());
        assertThat(credenciales(id)).isZero();
    }

    @Test
    void validaSesionClaveYCuerpoSinConsumirLaIntencion() throws Exception {
        UUID id = comprar("aprobar").ordenes().getFirst().ordenId();
        UUID clave = UUID.randomUUID();
        mvc.perform(post("/orders/" + id + "/listo")).andExpect(status().isUnauthorized());
        mvc.perform(get("/orders/" + id + "/qr")).andExpect(status().isUnauthorized());
        mvc.perform(post("/orders/" + id + "/listo").header("Authorization", bearer(cajero, "CAJERO", central)))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/orders/" + id + "/listo").header("Authorization", bearer(cajero, "CAJERO", central))
                .header("Idempotency-Key", "invalida")).andExpect(status().isBadRequest());
        mvc.perform(post("/orders/" + id + "/listo").header("Authorization", bearer(cajero, "CAJERO", central))
                .header("Idempotency-Key", clave).contentType(MediaType.APPLICATION_JSON).content("{\"retiroHasta\":\"2099\"}"))
                .andExpect(status().isBadRequest());
        preparar(id, clave).andExpect(status().isOk());
    }

    @Test
    void falloDelOutboxReviertePreparacionCredencialAuditoriaEIdempotencia() throws Exception {
        UUID id = comprar("aprobar").ordenes().getFirst().ordenId();
        UUID clave = UUID.randomUUID();
        int antes = eventos(id);
        OrderEventJournal journal = org.springframework.test.util.AopTestUtils.getUltimateTargetObject(events);
        doThrow(new IllegalStateException("outbox no disponible")).when(journal).append(anyString(), anyMap(), anyString(), any());
        preparar(id, clave).andExpect(status().isInternalServerError());
        assertThat(credenciales(id)).isZero();
        assertThat(consultas.orden(comprador, id).estado()).isEqualTo("pagado");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM idempotencia WHERE clave=?", Integer.class, clave)).isZero();
        assertThat(eventos(id)).isEqualTo(antes);
        doCallRealMethod().when(journal).append(anyString(), anyMap(), anyString(), any());
        preparar(id, clave).andExpect(status().isOk());
    }

    @Test
    void dosPreparacionesConcurrentesConLaMismaClaveReproducenUnUnicoResultado() throws Exception {
        UUID id = comprar("aprobar").ordenes().getFirst().ordenId();
        int antes = eventos(id);
        UUID clave = UUID.randomUUID();
        List<MvcResult> resultados = concurrentes(id, clave, clave);
        assertThat(resultados).allSatisfy(r -> assertThat(r.getResponse().getStatus()).isEqualTo(200));
        assertThat(resultados.getFirst().getResponse().getContentAsString())
                .isEqualTo(resultados.getLast().getResponse().getContentAsString());
        assertThat(resultados.stream().map(r -> r.getResponse().getHeader("Idempotency-Replayed")).toList())
                .containsExactlyInAnyOrder(null, "true");
        assertThat(credenciales(id)).isEqualTo(1);
        assertThat(eventos(id)).isEqualTo(antes + 1);
    }

    @Test
    void dosClavesConcurrentesSoloPreparanUnaVez() throws Exception {
        UUID id = comprar("aprobar").ordenes().getFirst().ordenId();
        int antes = eventos(id);
        var resultados = concurrentes(id, UUID.randomUUID(), UUID.randomUUID());
        assertThat(resultados.stream().map(r -> r.getResponse().getStatus()).toList()).containsExactlyInAnyOrder(200, 409);
        assertThat(credenciales(id)).isEqualTo(1);
        assertThat(eventos(id)).isEqualTo(antes + 1);
    }

    private List<MvcResult> concurrentes(UUID id, UUID primera, UUID segunda) throws Exception {
        CountDownLatch inicio = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var futuros = List.of(primera, segunda).stream().map(clave -> pool.submit(() -> {
                if (!inicio.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Sin inicio concurrente");
                return preparar(id, clave).andReturn();
            })).toList();
            inicio.countDown();
            return List.of(futuros.getFirst().get(30, TimeUnit.SECONDS), futuros.getLast().get(30, TimeUnit.SECONDS));
        }
    }

    private CompraResponse comprar(String escenario) throws Exception {
        String solicitud = json.writeValueAsString(Map.of("items", List.of(Map.of("ofertaId", oferta, "cantidad", 1))));
        var creada = mvc.perform(post("/compras").header("Authorization", bearer(comprador, "CLIENTE", null))
                .header("Idempotency-Key", UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON).content(solicitud))
                .andExpect(status().isCreated()).andReturn();
        UUID id = UUID.fromString(cuerpo(creada).path("compraId").asString());
        mvc.perform(post("/compras/" + id + "/pago").header("Authorization", bearer(comprador, "CLIENTE", null))
                .header("Idempotency-Key", UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"escenario\":\"" + escenario + "\"}")).andExpect(status().isCreated());
        return consultas.compra(comprador, id);
    }

    private ResultActions preparar(UUID orden, UUID clave) throws Exception {
        // El claim norte no reemplaza la asignación central persistida en Auth.
        return mvc.perform(post("/orders/" + orden + "/listo").header("Authorization", bearer(cajero, "CAJERO", norte))
                .header("Idempotency-Key", clave));
    }

    private ResultActions qr(UUID orden, UUID usuario, String rol) throws Exception {
        return mvc.perform(get("/orders/" + orden + "/qr").header("Authorization",
                bearer(usuario, rol, "CLIENTE".equals(rol) ? null : central)));
    }

    private JsonNode cuerpo(MvcResult respuesta) throws Exception {
        return json.readTree(respuesta.getResponse().getContentAsString());
    }

    private int credenciales(UUID orden) {
        return jdbc.queryForObject("SELECT count(*) FROM orden_retiros WHERE orden_id=?", Integer.class, orden);
    }

    private int eventos(UUID orden) {
        return jdbc.queryForObject("SELECT count(*) FROM order_outbox WHERE cuerpo LIKE ?", Integer.class, "%" + orden + "%");
    }

    private static String bearer(UUID usuario, String rol, UUID cafeteria) {
        var claims = claims().subject(usuario.toString()).claim("role", rol);
        if (cafeteria != null && ("CAJERO".equals(rol) || "ADMIN_CAFETERIA".equals(rol))) {
            claims.claim("cafeteriaId", cafeteria.toString());
        }
        return "Bearer " + sign(claims.build(), KEYS, JWSAlgorithm.RS256);
    }
}
