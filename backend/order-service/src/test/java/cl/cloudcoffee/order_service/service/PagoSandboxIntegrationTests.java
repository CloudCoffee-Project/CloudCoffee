package cl.cloudcoffee.order_service.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import org.springframework.amqp.core.MessageBuilder;
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

import com.nimbusds.jose.JWSAlgorithm;

import cl.cloudcoffee.order_service.dto.CompraResponse;
import cl.cloudcoffee.order_service.messaging.EventoResultadoPayment;
import cl.cloudcoffee.order_service.messaging.ResultadosPaymentConsumer;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago;
import cl.cloudcoffee.order_service.service.ResultadoExternoService.Efecto;
import cl.cloudcoffee.order_service.service.ResultadoPagoIntegrationTests.CatalogFake;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * INT2-113 de punta a punta con {@code ORDER_PAYMENT_PROVIDER=mercadopago_sandbox}: compra real (Order + Catalog
 * controlado), inicio del checkout en un payment-service controlado, resultados externos por evento o por
 * conciliación, y confirmación/liberación de reservas reutilizando INT2-77.
 */
@SpringBootTest(properties = {"management.tracing.enabled=false", "cloudcoffee.creation.recovery-enabled=false",
        "cloudcoffee.creation.publish-enabled=false", "cloudcoffee.revision.recovery-enabled=false",
        "cloudcoffee.pagos.recovery-enabled=true", "cloudcoffee.pagos.scan-ms=3600000",
        "cloudcoffee.pagos.provider=mercadopago_sandbox", "cloudcoffee.pagos.reconciliation-interval=PT2M"})
@AutoConfigureMockMvc
class PagoSandboxIntegrationTests extends JwtTestSupport {

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired JsonMapper json;
    @Autowired CatalogFake catalog;
    @Autowired PaymentFake payment;
    @Autowired ResultadoExternoService externos;
    @Autowired RecuperacionPagos recuperacion;
    @Autowired PasarelaPago pasarela;
    final UUID cliente = UUID.randomUUID();
    UUID oferta1, oferta2;

    @TestConfiguration
    static class Config {
        @Bean @Primary CatalogFake catalogFake() { return new CatalogFake(); }
        @Bean @Primary PaymentFake paymentFake() { return new PaymentFake(); }
    }

    @BeforeEach
    void preparar() {
        catalog.reset();
        payment.reset();
        jdbc.update("DELETE FROM liberaciones_reserva");
        UUID campus = UUID.randomUUID();
        oferta1 = catalog.oferta(campus, UUID.randomUUID(), 1800, 10);
        oferta2 = catalog.oferta(campus, UUID.randomUUID(), 1200, 10);
    }

    // ------------------------------------------------------------------ inicio del checkout

    @Test
    void startsOneCheckoutWithOrderAmountsAndExposesCorrelationAndInitPoint() throws Exception {
        CompraResponse compra = crear();
        UUID clave = UUID.randomUUID();
        MvcResult respuesta = pagar(compra.compraId(), clave, "{\"canalRetorno\":\"web\"}");

        assertStatus(respuesta, 201);
        assertThat(respuesta.getResponse().getHeader("Cache-Control")).isEqualTo("no-store");
        assertThat(respuesta.getResponse().getHeader("Idempotency-Replayed")).isEqualTo("false");
        JsonNode pago = cuerpo(respuesta);
        assertThat(pago.path("estado").asString()).isEqualTo("pendiente");
        assertThat(pago.path("motivo").asString()).isEqualTo("esperando_proveedor");
        assertThat(pago.path("simulado").asBoolean()).isFalse();
        assertThat(pago.path("proveedor").asString()).isEqualTo("mercadopago_sandbox");
        assertThat(pago.path("entorno").asString()).isEqualTo("sandbox");
        assertThat(pago.path("montoTotal").asLong()).isEqualTo(3000);
        assertThat(pago.path("initPoint").asString()).startsWith("https://www.mercadopago.cl/checkout");
        assertThat(pago.path("preferenciaId").asString()).isNotBlank();
        UUID paymentId = UUID.fromString(pago.path("paymentId").asString());
        cumpleElContrato(pago);

        // La solicitud a Payment sale de los snapshots de Order: ítems por orden, total y vencimiento común.
        assertThat(payment.llamadas).hasSize(1);
        JsonNode enviada = json.readTree(payment.llamadas.getFirst().cuerpo());
        assertThat(enviada.path("compraId").asString()).isEqualTo(compra.compraId().toString());
        assertThat(enviada.path("clienteId").asString()).isEqualTo(cliente.toString());
        assertThat(enviada.path("montoTotal").asLong()).isEqualTo(3000);
        assertThat(enviada.path("canalRetorno").asString()).isEqualTo("web");
        assertThat(enviada.path("items")).hasSize(2);
        assertThat(nombres(enviada)).containsExactlyInAnyOrder("compraId", "clienteId", "montoTotal", "moneda", "items",
                "canalRetorno", "expiraAt");
        long suma = 0;
        for (JsonNode item : enviada.path("items")) suma += item.path("precioUnitario").asLong() * item.path("cantidad").asLong();
        assertThat(suma).isEqualTo(3000);

        // Correlación persistida y visible al consultar (también en la compra, como pago no simulado).
        MvcResult consulta = consultar(compra.compraId());
        assertStatus(consulta, 200);
        assertThat(cuerpo(consulta).path("paymentId").asString()).isEqualTo(paymentId.toString());
        assertThat(cuerpo(consulta).path("initPoint").asString()).isEqualTo(pago.path("initPoint").asString());
        JsonNode enCompra = cuerpo(mvc.perform(get("/compras/" + compra.compraId()).header("Authorization", bearer())).andReturn())
                .path("pago");
        assertThat(enCompra.path("simulado").asBoolean()).isFalse();
        assertThat(enCompra.path("proveedor").asString()).isEqualTo("mercadopago_sandbox");
    }

    @Test
    void repeatingTheKeyReplaysTheCurrentCheckoutWithoutCallingPaymentAgain() throws Exception {
        CompraResponse compra = crear();
        UUID clave = UUID.randomUUID();
        JsonNode primera = cuerpo(pagar(compra.compraId(), clave, "{\"canalRetorno\":\"mobile\"}"));
        MvcResult repetida = pagar(compra.compraId(), clave, "{\"canalRetorno\":\"mobile\"}");
        assertStatus(repetida, 201);
        assertThat(repetida.getResponse().getHeader("Idempotency-Replayed")).isEqualTo("true");
        assertThat(cuerpo(repetida).path("paymentId")).isEqualTo(primera.path("paymentId"));
        assertThat(cuerpo(repetida).path("initPoint")).isEqualTo(primera.path("initPoint"));
        assertThat(payment.llamadas).hasSize(1);

        // Misma clave con otro canal, u otra clave: nunca un segundo checkout.
        assertProblem(pagar(compra.compraId(), clave, "{\"canalRetorno\":\"web\"}"), 409, "IDEMPOTENCY_CONFLICT");
        assertProblem(pagar(compra.compraId(), UUID.randomUUID(), "{\"canalRetorno\":\"mobile\"}"), 409, "PAGO_YA_INICIADO");
        assertThat(payment.llamadas).hasSize(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM pagos WHERE compra_id=?", Integer.class, compra.compraId())).isEqualTo(1);
    }

    @Test
    void simulatorCommandsAmountsAndUrlsAreRejectedInTheSandboxFlow() throws Exception {
        CompraResponse compra = crear();
        for (String cuerpo : List.of("{\"escenario\":\"aprobar\"}", "{\"canalRetorno\":\"web\",\"escenario\":\"aprobar\"}",
                "{\"canalRetorno\":\"web\",\"montoTotal\":1}", "{\"canalRetorno\":\"web\",\"returnUrl\":\"https://evil.test\"}",
                "{\"canalRetorno\":\"desktop\"}", "{}", "[]", "no-json", "")) {
            assertProblem(pagar(compra.compraId(), UUID.randomUUID(), cuerpo), 400, "SOLICITUD_INVALIDA");
        }
        assertThat(payment.llamadas).isEmpty();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM pagos WHERE compra_id=?", Integer.class, compra.compraId())).isZero();
    }

    @Test
    void ambiguousPaymentResponseIsRetriedWithTheSameKeyAndPayload() throws Exception {
        CompraResponse compra = crear();
        UUID clave = UUID.randomUUID();
        payment.respuestas.add(new PasarelaPago.CheckoutPendiente("PAGO_EN_CONCILIACION"));
        MvcResult primera = pagar(compra.compraId(), clave, "{\"canalRetorno\":\"web\"}");
        assertProblem(primera, 503, "PAGO_EN_CONCILIACION");
        assertThat(primera.getResponse().getHeader("Retry-After")).isEqualTo("2");
        // El pago existe (una sola intención) pero aún sin checkout: la consulta también pide reintentar.
        assertProblem(consultar(compra.compraId()), 503, "PAGO_EN_CONCILIACION");

        MvcResult reintento = pagar(compra.compraId(), clave, "{\"canalRetorno\":\"web\"}");
        assertStatus(reintento, 201);
        assertThat(reintento.getResponse().getHeader("Idempotency-Replayed")).isEqualTo("true");
        assertThat(payment.llamadas).hasSize(2);
        assertThat(payment.llamadas.get(0).clave()).isEqualTo(payment.llamadas.get(1).clave());
        assertThat(payment.llamadas.get(0).cuerpo()).isEqualTo(payment.llamadas.get(1).cuerpo());
    }

    @Test
    void concurrentRequestsFromSeveralReplicasStartASingleIntent() throws Exception {
        CompraResponse compra = crear();
        UUID clave = UUID.randomUUID();
        payment.demoraMs = 50;
        var pool = Executors.newFixedThreadPool(4);
        try {
            CountDownLatch salida = new CountDownLatch(1);
            List<Future<Integer>> trabajos = new ArrayList<>();
            for (int i = 0; i < 4; i++) {
                Callable<Integer> trabajo = () -> {
                    salida.await();
                    return pagar(compra.compraId(), clave, "{\"canalRetorno\":\"web\"}").getResponse().getStatus();
                };
                trabajos.add(pool.submit(trabajo));
            }
            salida.countDown();
            for (var trabajo : trabajos) assertThat(trabajo.get(20, TimeUnit.SECONDS)).isEqualTo(201);
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM pagos WHERE compra_id=?", Integer.class, compra.compraId())).isEqualTo(1);
        // Todas las llamadas (si hubo más de una) usan la misma clave: Payment devuelve la misma intención.
        assertThat(payment.llamadas.stream().map(PaymentFake.Llamada::clave).collect(Collectors.toSet())).hasSize(1);
        assertThat(payment.porClave).hasSize(1);
    }

    @Test
    void checkoutRequiresResolvedReviewAndValidReservations() throws Exception {
        CompraResponse enRevision = crear();
        jdbc.update("UPDATE compras SET estado='REVISION_REQUERIDA' WHERE id=?", enRevision.compraId());
        assertProblem(pagar(enRevision.compraId(), UUID.randomUUID(), "{\"canalRetorno\":\"web\"}"), 409, "REVISION_REQUERIDA");

        CompraResponse vencida = crear();
        jdbc.update("UPDATE compras SET reserva_expira_at=? WHERE id=?", LocalDateTime.of(2020, 1, 1, 0, 0), vencida.compraId());
        assertProblem(pagar(vencida.compraId(), UUID.randomUUID(), "{\"canalRetorno\":\"web\"}"), 409, "RESERVA_VENCIDA");
        assertThat(payment.llamadas).isEmpty();

        CompraResponse vencidaEnPayment = crear();
        payment.respuestas.add(new PasarelaPago.CheckoutRechazado("RESERVA_VENCIDA"));
        assertProblem(pagar(vencidaEnPayment.compraId(), UUID.randomUUID(), "{\"canalRetorno\":\"web\"}"), 409, "RESERVA_VENCIDA");
    }

    @Test
    void onlyTheOwningClientCanStartOrReadThePayment() throws Exception {
        CompraResponse compra = crear();
        String otro = "Bearer " + sign(claims().subject(UUID.randomUUID().toString()).claim("role", "CLIENTE").build(), KEYS, JWSAlgorithm.RS256);
        String cajero = "Bearer " + sign(claims().subject(cliente.toString()).claim("role", "CAJERO").build(), KEYS, JWSAlgorithm.RS256);
        assertProblem(mvc.perform(post("/compras/" + compra.compraId() + "/pago").header("Authorization", otro)
                .header("Idempotency-Key", UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"canalRetorno\":\"web\"}")).andReturn(), 404, "COMPRA_NO_ENCONTRADA");
        assertProblem(mvc.perform(post("/compras/" + compra.compraId() + "/pago").header("Authorization", cajero)
                .header("Idempotency-Key", UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"canalRetorno\":\"web\"}")).andReturn(), 403, "ROL_NO_PERMITIDO");
        assertStatus(pagar(compra.compraId(), UUID.randomUUID(), "{\"canalRetorno\":\"web\"}"), 201);
        assertProblem(mvc.perform(get("/compras/" + compra.compraId() + "/pago").header("Authorization", otro)).andReturn(),
                404, "COMPRA_NO_ENCONTRADA");
    }

    // ------------------------------------------------------------------ resultados externos

    @Test
    void approvedResultConfirmsEveryReservationBeforePayingAndIsAppliedOnce() throws Exception {
        CompraResponse compra = crear();
        JsonNode pago = iniciar(compra);
        UUID eventId = UUID.randomUUID();

        assertThat(aplicar(evento(eventId, pago, "aprobado", "proveedor_confirmado", 3))).isEqualTo(Efecto.APLICADO);

        assertThat(catalog.estados()).containsOnly("CONFIRMED");
        assertThat(catalog.confirmaciones).hasSize(2);
        JsonNode actual = cuerpo(consultar(compra.compraId()));
        assertThat(actual.path("estado").asString()).isEqualTo("aprobado");
        assertThat(actual.path("motivo").asString()).isEqualTo("proveedor_confirmado");
        assertThat(estadoCompra(compra)).isEqualTo("PAGADO");
        assertThat(jdbc.queryForList("SELECT estado FROM ordenes WHERE compra_id=?", String.class, compra.compraId()))
                .containsOnly("PAGADO");
        JsonNode eventoOrder = eventosPago(compra).getLast();
        assertThat(eventoOrder.path("payload").path("estado").asString()).isEqualTo("aprobado");
        assertThat(eventoOrder.path("payload").path("simulado").asBoolean()).isFalse();

        // Mismo eventId (redelivery) y una versión vieja (desorden): sin efectos.
        assertThat(aplicar(evento(eventId, pago, "aprobado", "proveedor_confirmado", 3))).isEqualTo(Efecto.DUPLICADO);
        assertThat(aplicar(evento(UUID.randomUUID(), pago, "pendiente", null, 2))).isEqualTo(Efecto.OBSOLETO);
        assertThat(catalog.confirmaciones).hasSize(2);
        assertThat(cuerpo(consultar(compra.compraId())).path("estado").asString()).isEqualTo("aprobado");
    }

    @Test
    void approvalWithCatalogDownStaysProcessingStockAndResumesAfterARestart() throws Exception {
        CompraResponse compra = crear();
        JsonNode pago = iniciar(compra);
        catalog.caido = true;
        aplicar(evento(UUID.randomUUID(), pago, "aprobado", "proveedor_confirmado", 3));
        JsonNode pendiente = cuerpo(consultar(compra.compraId()));
        assertThat(pendiente.path("estado").asString()).isEqualTo("pendiente");
        assertThat(pendiente.path("motivo").asString()).isEqualTo("procesando_stock");
        assertThat(estadoCompra(compra)).isEqualTo("PENDIENTE_PAGO");

        // El job de INT2-77 retoma la decisión durable (aquí: 2 s de margen ya cumplidos por SQL).
        catalog.caido = false;
        jdbc.update("UPDATE pagos SET created_at=? WHERE compra_id=?", LocalDateTime.of(2020, 1, 1, 0, 0), compra.compraId());
        recuperacion.recuperar();
        assertThat(cuerpo(consultar(compra.compraId())).path("estado").asString()).isEqualTo("aprobado");
        assertThat(estadoCompra(compra)).isEqualTo("PAGADO");
    }

    @Test
    void rejectionCancellationAndExpiryCompensateExactlyOnce() throws Exception {
        for (String[] caso : new String[][] {{"rechazado", "rechazado", "proveedor_rechazado"},
                {"cancelado", "cancelado", "proveedor_cancelado"}, {"vencido", "vencido", "reserva_vencida"}}) {
            catalog.liberadas.clear();
            CompraResponse compra = crear();
            JsonNode pago = iniciar(compra);
            aplicar(evento(UUID.randomUUID(), pago, caso[0], "motivo", 3));
            aplicar(evento(UUID.randomUUID(), pago, caso[0], "motivo", 4));
            JsonNode actual = cuerpo(consultar(compra.compraId()));
            assertThat(actual.path("estado").asString()).isEqualTo(caso[1]);
            assertThat(actual.path("motivo").asString()).isEqualTo(caso[2]);
            assertThat(estadoCompra(compra)).isEqualTo("CANCELADO");
            assertThat(catalog.liberadas).hasSize(2);
            assertThat(catalog.confirmaciones).isEmpty();
            assertThat(eventosPago(compra).stream().map(e -> e.path("payload").path("estado").asString()))
                    .containsExactly("pendiente", caso[1]);
        }
    }

    @Test
    void approvalAfterLocalExpiryRequiresReconciliationWithoutRecreatingStock() throws Exception {
        CompraResponse compra = crear();
        JsonNode pago = iniciar(compra);
        jdbc.update("UPDATE compras SET reserva_expira_at=? WHERE id=?", LocalDateTime.of(2020, 1, 1, 0, 0), compra.compraId());
        // Payment todavía informa pendiente: Order vence localmente y libera las reservas una vez.
        recuperacion.recuperar();
        assertThat(cuerpo(consultar(compra.compraId())).path("estado").asString()).isEqualTo("vencido");
        assertThat(catalog.liberadas).hasSize(2);
        Map<UUID, Integer> stock = Map.copyOf(catalog.stock);

        aplicar(evento(UUID.randomUUID(), pago, "aprobado", "proveedor_confirmado", 3));
        JsonNode actual = cuerpo(consultar(compra.compraId()));
        assertThat(actual.path("estado").asString()).isEqualTo("requiere_conciliacion");
        assertThat(actual.path("motivo").asString()).isEqualTo("aprobacion_con_stock_liberado");
        assertThat(estadoCompra(compra)).isEqualTo("CANCELADO");
        assertThat(catalog.confirmaciones).isEmpty();
        assertThat(catalog.stock).isEqualTo(stock);
    }

    @Test
    void approvalWhoseReservationsAlreadyExpiredInCatalogRequiresReconciliation() throws Exception {
        CompraResponse compra = crear();
        JsonNode pago = iniciar(compra);
        catalog.vencer();
        aplicar(evento(UUID.randomUUID(), pago, "aprobado", "proveedor_confirmado", 3));
        JsonNode actual = cuerpo(consultar(compra.compraId()));
        assertThat(actual.path("estado").asString()).isEqualTo("requiere_conciliacion");
        assertThat(actual.path("motivo").asString()).isEqualTo("stock_no_confirmado");
        assertThat(estadoCompra(compra)).isEqualTo("CANCELADO");
    }

    @Test
    void reconciliationResultFromPaymentBlocksFulfillmentOfAPaidPurchase() throws Exception {
        CompraResponse compra = crear();
        JsonNode pago = iniciar(compra);
        aplicar(evento(UUID.randomUUID(), pago, "aprobado", "proveedor_confirmado", 3));
        aplicar(evento(UUID.randomUUID(), pago, "requiere_conciliacion", "doble_aprobacion", 4));
        JsonNode actual = cuerpo(consultar(compra.compraId()));
        assertThat(actual.path("estado").asString()).isEqualTo("requiere_conciliacion");
        assertThat(actual.path("motivo").asString()).isEqualTo("doble_aprobacion");
        // El hecho financiero no se revierte (sin reembolso automático) y no se libera stock confirmado.
        assertThat(estadoCompra(compra)).isEqualTo("PAGADO");
        assertThat(catalog.liberadas).isEmpty();
    }

    @Test
    void lostEventsAreRecoveredByQueryingPaymentAfterARestart() throws Exception {
        CompraResponse compra = crear();
        iniciar(compra);
        payment.estado(compra.compraId(), "aprobado", 5);
        recuperacion.recuperar();
        assertThat(cuerpo(consultar(compra.compraId())).path("estado").asString()).isEqualTo("aprobado");
        assertThat(estadoCompra(compra)).isEqualTo("PAGADO");
        // La consulta no se repite antes del intervalo.
        payment.estado(compra.compraId(), "requiere_conciliacion", 6);
        recuperacion.recuperar();
        assertThat(cuerpo(consultar(compra.compraId())).path("estado").asString()).isEqualTo("aprobado");
    }

    @Test
    void checkoutsNeverObtainedAreResumedByTheRecoveryJob() throws Exception {
        CompraResponse compra = crear();
        UUID clave = UUID.randomUUID();
        payment.respuestas.add(new PasarelaPago.CheckoutPendiente("PAYMENT_NO_DISPONIBLE"));
        assertProblem(pagar(compra.compraId(), clave, "{\"canalRetorno\":\"web\"}"), 503, "PAGO_EN_CONCILIACION");
        jdbc.update("UPDATE pagos SET created_at=? WHERE compra_id=?", LocalDateTime.of(2020, 1, 1, 0, 0), compra.compraId());
        recuperacion.recuperar();
        assertStatus(consultar(compra.compraId()), 200);
        assertThat(payment.llamadas).hasSize(2);
        assertThat(payment.llamadas.get(0).clave()).isEqualTo(payment.llamadas.get(1).clave());
    }

    @Test
    void consumerSendsInvalidOrInconsistentEventsToTheDeadLetterQueue() throws Exception {
        CompraResponse compra = crear();
        JsonNode pago = iniciar(compra);
        var consumidor = new ResultadosPaymentConsumer(externos);
        assertThatThrownBy(() -> consumidor.consumir(MessageBuilder.withBody("no-json".getBytes()).build()))
                .isInstanceOf(AmqpRejectAndDontRequeueException.class);
        byte[] montoDistinto = evento(UUID.randomUUID(), pago, "aprobado", "x", 3).replace("\"montoTotal\":3000", "\"montoTotal\":1")
                .getBytes(StandardCharsets.UTF_8);
        assertThatThrownBy(() -> consumidor.consumir(MessageBuilder.withBody(montoDistinto).build()))
                .isInstanceOf(AmqpRejectAndDontRequeueException.class);
        assertThat(cuerpo(consultar(compra.compraId())).path("estado").asString()).isEqualTo("pendiente");

        consumidor.consumir(MessageBuilder.withBody(evento(UUID.randomUUID(), pago, "aprobado", "x", 3)
                .getBytes(StandardCharsets.UTF_8)).build());
        assertThat(cuerpo(consultar(compra.compraId())).path("estado").asString()).isEqualTo("aprobado");
    }

    // ------------------------------------------------------------------ utilidades

    private Efecto aplicar(String evento) {
        return externos.aplicar(EventoResultadoPayment.leer(evento.getBytes(StandardCharsets.UTF_8)));
    }

    private String evento(UUID eventId, JsonNode pago, String estado, String motivo, long version) {
        return """
                {"eventId":"%s","eventType":"payment.pago.resultado.v1","timestamp":"2026-11-13T15:02:00Z",
                 "traceId":"0123456789abcdef0123456789abcdef",
                 "payload":{"paymentId":"%s","compraId":"%s","clienteId":"%s","preferenciaId":"%s",
                  "proveedorPagoId":"123","estado":"%s","motivo":"%s","montoTotal":%d,"moneda":"CLP",
                  "proveedor":"mercadopago_sandbox","entorno":"sandbox","version":%d,
                  "ocurridoAt":"2026-11-13T15:02:00Z","expiraAt":"2026-11-13T15:15:00Z"}}
                """.formatted(eventId, pago.path("paymentId").asString(), pago.path("compraId").asString(), cliente,
                pago.path("preferenciaId").asString(), estado, motivo == null ? "pendiente" : motivo,
                pago.path("montoTotal").asLong(), version);
    }

    private JsonNode iniciar(CompraResponse compra) throws Exception {
        MvcResult respuesta = pagar(compra.compraId(), UUID.randomUUID(), "{\"canalRetorno\":\"web\"}");
        assertStatus(respuesta, 201);
        return cuerpo(respuesta);
    }

    private CompraResponse crear() throws Exception {
        var items = Arrays.asList(Map.of("ofertaId", oferta1, "cantidad", 1), Map.of("ofertaId", oferta2, "cantidad", 1));
        var respuesta = mvc.perform(post("/compras").header("Authorization", bearer())
                .header("Idempotency-Key", UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("items", items)))).andReturn();
        assertStatus(respuesta, 201);
        return json.readValue(respuesta.getResponse().getContentAsString(), CompraResponse.class);
    }

    private MvcResult pagar(UUID compra, UUID clave, String cuerpo) throws Exception {
        return mvc.perform(post("/compras/" + compra + "/pago").header("Authorization", bearer())
                .header("Idempotency-Key", clave).contentType(MediaType.APPLICATION_JSON).content(cuerpo)).andReturn();
    }

    private MvcResult consultar(UUID compra) throws Exception {
        return mvc.perform(get("/compras/" + compra + "/pago").header("Authorization", bearer())).andReturn();
    }

    private String estadoCompra(CompraResponse compra) {
        return jdbc.queryForObject("SELECT estado FROM compras WHERE id=?", String.class, compra.compraId());
    }

    private List<JsonNode> eventosPago(CompraResponse compra) {
        return jdbc.queryForList("SELECT cuerpo FROM order_outbox WHERE cuerpo LIKE ? ORDER BY created_at", String.class,
                        "%" + compra.compraId() + "%").stream().map(json::readTree)
                .filter(e -> e.path("eventType").asString().equals("order.pago.resultado.v1")).toList();
    }

    /** PagoSandbox del contrato Payment 2.0.0 (campos exactos). */
    private void cumpleElContrato(JsonNode pago) {
        JsonNode esquema = json.readTree(new java.io.File("../docs/payment-service.openapi.json"))
                .path("components").path("schemas").path("PagoSandbox");
        Set<String> requeridos = new java.util.HashSet<>();
        esquema.path("required").forEach(campo -> requeridos.add(campo.asString()));
        assertThat(nombres(pago)).isEqualTo(requeridos);
    }

    private static Set<String> nombres(JsonNode nodo) {
        Set<String> nombres = new java.util.HashSet<>();
        nodo.properties().forEach(e -> nombres.add(e.getKey()));
        return nombres;
    }

    private JsonNode cuerpo(MvcResult respuesta) throws Exception {
        return json.readTree(respuesta.getResponse().getContentAsString());
    }

    private void assertStatus(MvcResult respuesta, int status) throws Exception {
        assertThat(respuesta.getResponse().getStatus()).as(respuesta.getResponse().getContentAsString()).isEqualTo(status);
    }

    private void assertProblem(MvcResult respuesta, int status, String code) throws Exception {
        assertStatus(respuesta, status);
        assertThat(cuerpo(respuesta).path("code").asString()).isEqualTo(code);
    }

    private String bearer() {
        return "Bearer " + sign(claims().subject(cliente.toString()).claim("role", "CLIENTE").build(), KEYS, JWSAlgorithm.RS256);
    }
}
