package cl.cloudcoffee.payment_service.preferencias;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import cl.cloudcoffee.security.testing.JwtTestSupport;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** INT2-111 de punta a punta (seguridad real, H2 migrado con Flyway) con un proveedor controlado. */
@SpringBootTest(properties = {
        "management.health.rabbit.enabled=false",
        "management.tracing.export.zipkin.enabled=false",
        "cloudcoffee.payment.provider=mercadopago_sandbox",
        "cloudcoffee.payment.access-token=APP_USR-test-token",
        "cloudcoffee.payment.checkout-mode=test-user",
        "cloudcoffee.payment.web-return-url=https://app.cloudcoffee.test/pagos/retorno",
        "cloudcoffee.payment.mobile-return-url=https://app.cloudcoffee.test/m/pagos/retorno",
        "cloudcoffee.payment.reconciliation-settle-time=PT1M",
        // Sin tareas en segundo plano: no deben consultar al proveedor real mientras corren estas pruebas.
        "cloudcoffee.payment.processing.enabled=false"})
@AutoConfigureMockMvc
class PreferenciasInternasIntegrationTests extends JwtTestSupport {

    static final String RUTA = "/internal/servicios/payments/preferencias";
    static final Instant INICIO = Instant.parse("2026-11-13T15:00:00Z");

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ProveedorControlado proveedor;
    @Autowired RelojControlado reloj;
    final JsonMapper json = JsonMapper.builder().build();

    UUID compra;
    UUID cliente;

    @TestConfiguration
    static class Proveedor {
        @Bean @Primary ProveedorControlado proveedorControlado() { return new ProveedorControlado(); }
        @Bean @Primary RelojControlado relojControlado() { return new RelojControlado(); }
    }

    static class RelojControlado extends Clock {
        volatile Instant ahora = INICIO;
        void avanzar(Duration d) { ahora = ahora.plus(d); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return ahora; }
    }

    // En el job PostgreSQL de CI todos los contextos comparten la base: no dejar intenciones para otras clases.
    @AfterEach
    void borrarIntenciones() {
        jdbc.update("DELETE FROM payment_outbox");
        jdbc.update("DELETE FROM payment_inbox");
        jdbc.update("DELETE FROM payment_anomaly");
        jdbc.update("DELETE FROM provider_payment");
        jdbc.update("DELETE FROM payment_preference");
        jdbc.update("DELETE FROM payment_intent");
    }

    @BeforeEach
    void limpiar() {
        borrarIntenciones();
        proveedor.reiniciar();
        reloj.ahora = INICIO;
        compra = UUID.randomUUID();
        cliente = UUID.randomUUID();
    }

    String solicitud() {
        return solicitud("web", 4800, "2026-11-13T15:15:00Z");
    }

    /** Compra de dos cafeterías: 2 × 1.800 + 1 × 1.200 = 4.800 CLP en una sola preferencia. */
    String solicitud(String canal, Object total, String expira) {
        return """
                {"compraId":"%s","clienteId":"%s","montoTotal":%s,"moneda":"CLP","canalRetorno":"%s","expiraAt":"%s",
                 "items":[{"ordenId":"40000000-0000-4000-8000-000000000001","ofertaId":"50000000-0000-4000-8000-000000000001","titulo":"Café americano","cantidad":2,"precioUnitario":1800},
                          {"ordenId":"40000000-0000-4000-8000-000000000002","ofertaId":"50000000-0000-4000-8000-000000000002","titulo":"Té","cantidad":1,"precioUnitario":1200}]}
                """.formatted(compra, cliente, total, canal, expira);
    }

    ResultActions crear(UUID clave, String cuerpo) throws Exception {
        var request = post(RUTA).header("X-Internal-Service-Token", INTERNAL_TOKEN)
                .contentType(MediaType.APPLICATION_JSON).content(cuerpo);
        if (clave != null) request.header("Idempotency-Key", clave.toString());
        return mvc.perform(request);
    }

    ResultActions consultar(UUID compraId) throws Exception {
        return mvc.perform(get(RUTA + "/" + compraId).header("X-Internal-Service-Token", INTERNAL_TOKEN));
    }

    int filas(String tabla) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + tabla, Integer.class);
    }

    String estado() {
        return jdbc.queryForObject("SELECT status FROM payment_intent WHERE compra_id = ?", String.class, compra);
    }

    @Test
    void createsAndPersistsOnePreferenceWithStableReferenceAndConfiguredReturnUrls() throws Exception {
        String respuesta = crear(UUID.randomUUID(), solicitud())
                .andExpect(status().isCreated())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Idempotency-Replayed", "false"))
                .andExpect(jsonPath("$.compraId").value(compra.toString()))
                .andExpect(jsonPath("$.clienteId").value(cliente.toString()))
                .andExpect(jsonPath("$.preferenciaId").value("pref-1"))
                .andExpect(jsonPath("$.initPoint").value("https://www.mercadopago.cl/checkout/v1/redirect?pref_id=pref-1"))
                .andExpect(jsonPath("$.estado").value("pendiente"))
                .andExpect(jsonPath("$.montoTotal").value(4800))
                .andExpect(jsonPath("$.moneda").value("CLP"))
                .andExpect(jsonPath("$.entorno").value("sandbox"))
                .andExpect(jsonPath("$.expiraAt").value("2026-11-13T15:15:00Z"))
                .andExpect(jsonPath("$.version").value(greaterThanOrEqualTo(1)))
                .andReturn().getResponse().getContentAsString();
        var nodo = json.readTree(respuesta);
        assertThat(nodo.path("referenciaExterna").asString()).isEqualTo(nodo.path("paymentId").asString());

        assertThat(estado()).isEqualTo("PENDING");
        assertThat(jdbc.queryForObject("SELECT provider_preference_id FROM payment_preference", String.class)).isEqualTo("pref-1");
        assertThat(jdbc.queryForObject("SELECT amount FROM payment_intent", Long.class)).isEqualTo(4800L);

        var enviada = proveedor.recibidas.getFirst();
        assertThat(enviada.referenciaExterna()).isEqualTo(nodo.path("paymentId").asString());
        assertThat(enviada.items()).extracting(i -> i.precioUnitario() * i.cantidad()).containsExactly(3600L, 1200L);
        assertThat(enviada.exito().toString())
                .isEqualTo("https://app.cloudcoffee.test/pagos/retorno?compraId=" + compra + "&resultado=exito");
        assertThat(enviada.pendiente().toString()).endsWith("resultado=pendiente");
        assertThat(enviada.fallo().toString()).endsWith("resultado=fallo");
    }

    @Test
    void mobileChannelUsesOnlyTheConfiguredMobileReturnUrl() throws Exception {
        crear(UUID.randomUUID(), solicitud("mobile", 4800, "2026-11-13T15:15:00Z")).andExpect(status().isCreated());
        assertThat(proveedor.recibidas.getFirst().exito().toString())
                .startsWith("https://app.cloudcoffee.test/m/pagos/retorno?compraId=" + compra);
    }

    @Test
    void repeatingTheIntentNeverCreatesAnotherPreference() throws Exception {
        UUID clave = UUID.randomUUID();
        String paymentId = json.readTree(crear(clave, solicitud()).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()).path("paymentId").asString();

        crear(clave, solicitud()).andExpect(status().isCreated())
                .andExpect(header().string("Idempotency-Replayed", "true"))
                .andExpect(jsonPath("$.paymentId").value(paymentId))
                .andExpect(jsonPath("$.preferenciaId").value("pref-1"));
        // Otra clave para la misma compra con la misma carga devuelve la intención existente.
        crear(UUID.randomUUID(), solicitud()).andExpect(status().isCreated())
                .andExpect(header().string("Idempotency-Replayed", "true"))
                .andExpect(jsonPath("$.paymentId").value(paymentId));

        assertThat(proveedor.creaciones.get()).isEqualTo(1);
        assertThat(filas("payment_intent")).isEqualTo(1);
        assertThat(filas("payment_preference")).isEqualTo(1);
    }

    @Test
    void conflictingPayloadsNeverReplaceAnExistingPreference() throws Exception {
        UUID clave = UUID.randomUUID();
        crear(clave, solicitud()).andExpect(status().isCreated());

        crear(clave, solicitud("mobile", 4800, "2026-11-13T15:15:00Z"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCIA_CONFLICTO"));
        crear(UUID.randomUUID(), solicitud("mobile", 4800, "2026-11-13T15:15:00Z"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PAGO_YA_INICIADO"));

        assertThat(proveedor.creaciones.get()).isEqualTo(1);
        assertThat(filas("payment_preference")).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"total-distinto", "total-decimal", "total-texto", "moneda", "canal", "campo-extra",
            "url-retorno", "item-extra", "sin-items", "cantidad-cero", "precio-negativo", "uuid-invalido", "no-objeto"})
    void amountsAndFieldsComeOnlyFromAValidOrderCommand(String caso) throws Exception {
        String base = solicitud();
        String cuerpo = switch (caso) {
            case "total-distinto" -> solicitud("web", 4700, "2026-11-13T15:15:00Z");
            case "total-decimal" -> solicitud("web", "4800.5", "2026-11-13T15:15:00Z");
            case "total-texto" -> solicitud("web", "\"4800\"", "2026-11-13T15:15:00Z");
            case "moneda" -> base.replace("\"CLP\"", "\"USD\"");
            case "canal" -> solicitud("desktop", 4800, "2026-11-13T15:15:00Z");
            case "campo-extra" -> base.replace("{\"compraId\"", "{\"estado\":\"aprobado\",\"compraId\"");
            case "url-retorno" -> base.replace("{\"compraId\"", "{\"urlRetorno\":\"https://evil.test\",\"compraId\"");
            case "item-extra" -> base.replace("\"cantidad\":1,", "\"cantidad\":1,\"descuento\":100,");
            case "sin-items" -> base.replaceAll("(?s)\"items\":\\[.*]", "\"items\":[]");
            case "cantidad-cero" -> base.replace("\"cantidad\":1,", "\"cantidad\":0,");
            case "precio-negativo" -> base.replace("\"precioUnitario\":1200", "\"precioUnitario\":-1200");
            case "uuid-invalido" -> base.replace(compra.toString(), "no-es-uuid");
            default -> "[]";
        };
        crear(UUID.randomUUID(), cuerpo)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("SOLICITUD_INVALIDA"));
        assertThat(filas("payment_intent")).isZero();
        assertThat(proveedor.creaciones.get()).isZero();
    }

    @Test
    void idempotencyKeyIsRequiredAndMustBeAUuid() throws Exception {
        crear(null, solicitud()).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("SOLICITUD_INVALIDA"));
        mvc.perform(post(RUTA).header("X-Internal-Service-Token", INTERNAL_TOKEN).header("Idempotency-Key", "abc")
                        .contentType(MediaType.APPLICATION_JSON).content(solicitud()))
                .andExpect(status().isBadRequest());
        crear(UUID.randomUUID(), "{no json").andExpect(status().isBadRequest());
        assertThat(filas("payment_intent")).isZero();
    }

    @Test
    void expiredPurchaseNeverOpensCheckout() throws Exception {
        crear(UUID.randomUUID(), solicitud("web", 4800, "2026-11-13T14:59:59Z"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RESERVA_VENCIDA"));
        assertThat(filas("payment_intent")).isZero();
        assertThat(proveedor.creaciones.get()).isZero();
    }

    @Test
    void lostResponseIsReconciledWithTheSameIntentWithoutCreatingAgain() throws Exception {
        UUID clave = UUID.randomUUID();
        proveedor.programar(ProveedorControlado.Respuesta.PERDIDA_TRAS_CREAR);

        crear(clave, solicitud())
                .andExpect(status().isServiceUnavailable())
                .andExpect(header().string("Retry-After", "2"))
                .andExpect(jsonPath("$.code").value("PAGO_EN_CONCILIACION"));
        assertThat(estado()).isEqualTo("REQUIRES_RECONCILIATION");
        assertThat(filas("payment_preference")).isZero();

        // La consulta solo lee: informa la conciliación sin llamar al proveedor.
        consultar(compra).andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("requiere_conciliacion"))
                .andExpect(jsonPath("$.preferenciaId").value(nullValue()))
                .andExpect(jsonPath("$.initPoint").value(nullValue()));
        assertThat(proveedor.busquedas.get()).isZero();

        crear(clave, solicitud()).andExpect(status().isCreated())
                .andExpect(jsonPath("$.preferenciaId").value("pref-1"))
                .andExpect(jsonPath("$.estado").value("pendiente"));
        assertThat(proveedor.creaciones.get()).isEqualTo(1);
        assertThat(proveedor.busquedas.get()).isEqualTo(1);
        assertThat(filas("payment_preference")).isEqualTo(1);
    }

    @Test
    void afterATimeoutCreationIsRetriedOnlyWhenTheSearchStaysEmptyPastTheSettleTime() throws Exception {
        UUID clave = UUID.randomUUID();
        proveedor.programar(ProveedorControlado.Respuesta.INCIERTA_SIN_CREAR);
        crear(clave, solicitud()).andExpect(status().isServiceUnavailable());

        reloj.avanzar(Duration.ofSeconds(30));
        crear(clave, solicitud()).andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("PAGO_EN_CONCILIACION"));
        assertThat(proveedor.creaciones.get()).isEqualTo(1);

        reloj.avanzar(Duration.ofSeconds(31));
        crear(clave, solicitud()).andExpect(status().isCreated()).andExpect(jsonPath("$.preferenciaId").value("pref-2"));
        assertThat(proveedor.creaciones.get()).isEqualTo(2);
        assertThat(proveedor.existentes.get(proveedor.recibidas.getFirst().referenciaExterna())).hasSize(1);
    }

    @Test
    void failedSearchKeepsReconciliationAndNeverCreatesBlindly() throws Exception {
        UUID clave = UUID.randomUUID();
        proveedor.programar(ProveedorControlado.Respuesta.INCIERTA_SIN_CREAR);
        crear(clave, solicitud()).andExpect(status().isServiceUnavailable());
        proveedor.busquedaFalla = true;
        reloj.avanzar(Duration.ofMinutes(5));

        crear(clave, solicitud()).andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("PAGO_EN_CONCILIACION"));
        assertThat(proveedor.creaciones.get()).isEqualTo(1);
        assertThat(estado()).isEqualTo("REQUIRES_RECONCILIATION");
    }

    @Test
    void duplicatePreferencesAtTheProviderRequireOperationalReview() throws Exception {
        UUID clave = UUID.randomUUID();
        proveedor.programar(ProveedorControlado.Respuesta.PERDIDA_TRAS_CREAR);
        crear(clave, solicitud()).andExpect(status().isServiceUnavailable());
        proveedor.existente(proveedor.recibidas.getFirst().referenciaExterna());

        crear(clave, solicitud()).andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("PAGO_EN_CONCILIACION"));
        assertThat(filas("payment_preference")).isZero();
        assertThat(proveedor.creaciones.get()).isEqualTo(1);
    }

    @Test
    void expiredIntentInReconciliationIsNotRecreated() throws Exception {
        UUID clave = UUID.randomUUID();
        proveedor.programar(ProveedorControlado.Respuesta.INCIERTA_SIN_CREAR);
        crear(clave, solicitud()).andExpect(status().isServiceUnavailable());
        reloj.avanzar(Duration.ofMinutes(20));

        crear(clave, solicitud()).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("RESERVA_VENCIDA"));
        assertThat(proveedor.creaciones.get()).isEqualTo(1);
        assertThat(estado()).isEqualTo("REQUIRES_RECONCILIATION");
    }

    @Test
    void definitiveProviderRejectionAllowsARetryWithoutReconciliation() throws Exception {
        UUID clave = UUID.randomUUID();
        proveedor.programar(ProveedorControlado.Respuesta.RECHAZADA);
        crear(clave, solicitud()).andExpect(status().isServiceUnavailable())
                .andExpect(header().string("Retry-After", "2"))
                .andExpect(jsonPath("$.code").value("PROVEEDOR_NO_DISPONIBLE"));
        assertThat(estado()).isEqualTo("CREATING");

        crear(clave, solicitud()).andExpect(status().isCreated());
        assertThat(proveedor.creaciones.get()).isEqualTo(2);
        assertThat(proveedor.busquedas.get()).isZero();
    }

    @Test
    void concurrentRequestsForTheSamePurchaseCallTheProviderOnce() throws Exception {
        proveedor.demoraMs = 300;
        UUID clave = UUID.randomUUID();
        String cuerpo = solicitud();
        ExecutorService pool = Executors.newFixedThreadPool(6);
        CountDownLatch salida = new CountDownLatch(1);
        List<Future<Integer>> futuros = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            UUID claveHilo = i % 2 == 0 ? clave : UUID.randomUUID();
            futuros.add(pool.submit(() -> {
                salida.await();
                return crear(claveHilo, cuerpo).andReturn().getResponse().getStatus();
            }));
        }
        salida.countDown();
        List<Integer> estados = Collections.synchronizedList(new ArrayList<>());
        for (var futuro : futuros) estados.add(futuro.get(30, TimeUnit.SECONDS));
        pool.shutdown();

        assertThat(estados).allMatch(s -> s == 201 || s == 503).contains(201);
        assertThat(proveedor.creaciones.get()).isEqualTo(1);
        assertThat(filas("payment_intent")).isEqualTo(1);
        assertThat(filas("payment_preference")).isEqualTo(1);
    }

    @Test
    void concurrentRetriesOfAnIntentInCreatingCallTheProviderOnce() throws Exception {
        UUID clave = UUID.randomUUID();
        proveedor.programar(ProveedorControlado.Respuesta.RECHAZADA);
        crear(clave, solicitud()).andExpect(status().isServiceUnavailable());
        assertThat(estado()).isEqualTo("CREATING");
        proveedor.demoraMs = 300;

        ExecutorService pool = Executors.newFixedThreadPool(8);
        CountDownLatch salida = new CountDownLatch(1);
        List<Future<Integer>> futuros = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            futuros.add(pool.submit(() -> {
                salida.await();
                return crear(clave, solicitud()).andReturn().getResponse().getStatus();
            }));
        }
        salida.countDown();
        for (var futuro : futuros) assertThat(futuro.get(30, TimeUnit.SECONDS)).isIn(201, 503);
        pool.shutdown();

        assertThat(proveedor.creaciones.get()).isEqualTo(2);
        assertThat(filas("payment_preference")).isEqualTo(1);
    }

    @Autowired IntencionRepository intenciones;

    @Test
    void onlyOneRequestCanClaimOrResolveAGivenIntentVersion() {
        UUID id = UUID.randomUUID();
        var solicitud = SolicitudPreferencia.desde(json.readTree(solicitud()));
        intenciones.insertar(id, UUID.randomUUID(), solicitud, "a".repeat(64), "{}", INICIO);

        assertThat(intenciones.reclamar(id, 0, "CREATING", INICIO)).isTrue();
        // Versión vieja o estado distinto: la segunda solicitud no gana el derecho a llamar al proveedor.
        assertThat(intenciones.reclamar(id, 0, "CREATING", INICIO)).isFalse();
        assertThat(intenciones.reclamar(id, 0, "REQUIRES_RECONCILIATION", INICIO)).isFalse();
        assertThat(intenciones.reclamar(id, 1, "CREATING", INICIO)).isFalse();
        assertThat(intenciones.guardarPreferencia(id, 0, "pref-vieja", "https://x.test/a", INICIO)).isFalse();
        assertThat(intenciones.liberar(id, 0, INICIO)).isFalse();

        assertThat(intenciones.guardarPreferencia(id, 1, "pref-1", "https://x.test/a", INICIO)).isTrue();
        assertThat(intenciones.guardarPreferencia(id, 2, "pref-2", "https://x.test/b", INICIO)).isFalse();
        assertThat(intenciones.reclamar(id, 2, "REQUIRES_RECONCILIATION", INICIO)).isFalse();
        assertThat(intenciones.porId(id).preferenciaId()).isEqualTo("pref-1");
        assertThat(filas("payment_preference")).isEqualTo(1);
    }

    @Test
    void queryReturnsPersistedStateAndNeverStartsAPayment() throws Exception {
        crear(UUID.randomUUID(), solicitud()).andExpect(status().isCreated());
        consultar(compra).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.preferenciaId").value("pref-1"))
                .andExpect(jsonPath("$.estado").value("pendiente"));
        consultar(UUID.randomUUID()).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("PAGO_NO_ENCONTRADO"));
        mvc.perform(get(RUTA + "/no-uuid").header("X-Internal-Service-Token", INTERNAL_TOKEN))
                .andExpect(status().isBadRequest());
        assertThat(proveedor.creaciones.get()).isEqualTo(1);
        assertThat(proveedor.busquedas.get()).isZero();
    }

    @Test
    void onlyTheInternalServiceTokenGrantsAccess() throws Exception {
        String superAdmin = sign(claims().claim("role", "SUPER_ADMIN").build(), KEYS, com.nimbusds.jose.JWSAlgorithm.RS256);
        String cliente = sign(claims().claim("role", "CLIENTE").build(), KEYS, com.nimbusds.jose.JWSAlgorithm.RS256);
        mvc.perform(post(RUTA).contentType(MediaType.APPLICATION_JSON).content(solicitud())
                .header("Idempotency-Key", UUID.randomUUID().toString())).andExpect(status().isUnauthorized());
        mvc.perform(post(RUTA).header("X-Internal-Service-Token", "otro-token-que-no-es-el-configurado-123")
                .contentType(MediaType.APPLICATION_JSON).content(solicitud())).andExpect(status().isUnauthorized());
        for (String jwt : List.of(superAdmin, cliente)) {
            mvc.perform(post(RUTA).header(HttpHeaders.AUTHORIZATION, "Bearer " + jwt)
                    .header("Idempotency-Key", UUID.randomUUID().toString())
                    .contentType(MediaType.APPLICATION_JSON).content(solicitud())).andExpect(status().isForbidden());
            mvc.perform(get(RUTA + "/" + compra).header(HttpHeaders.AUTHORIZATION, "Bearer " + jwt))
                    .andExpect(status().isForbidden());
        }
        assertThat(filas("payment_intent")).isZero();
        assertThat(proveedor.creaciones.get()).isZero();
    }
}
