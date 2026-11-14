package cl.cloudcoffee.payment_service.pagos;

import java.io.File;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
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
import org.springframework.test.web.servlet.ResultActions;

import cl.cloudcoffee.payment_service.messaging.CanalEventos.Envio;
import cl.cloudcoffee.payment_service.messaging.PublicadorEventos;
import cl.cloudcoffee.payment_service.mercadopago.ProveedorPagos.PagoProveedor;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * INT2-112 de punta a punta: webhook firmado → inbox → consulta al proveedor → transición de la intención →
 * outbox → publicación. Seguridad real y H2 migrado con Flyway; proveedor, broker y reloj controlados.
 */
@SpringBootTest(properties = {
        "management.health.rabbit.enabled=false",
        "management.tracing.export.zipkin.enabled=false",
        "cloudcoffee.payment.provider=mercadopago_sandbox",
        "cloudcoffee.payment.access-token=APP_USR-test-token",
        "cloudcoffee.payment.checkout-mode=test-user",
        "cloudcoffee.payment.web-return-url=https://app.cloudcoffee.test/pagos/retorno",
        "cloudcoffee.payment.mobile-return-url=https://app.cloudcoffee.test/m/pagos/retorno",
        "cloudcoffee.payment.webhook-secret=" + PagosIntegrationTests.SECRETO,
        "cloudcoffee.payment.webhook-public-url=https://api.cloudcoffee.test/v1/payments/webhooks/mercadopago",
        "cloudcoffee.payment.signature-tolerance=PT5M",
        "cloudcoffee.payment.processing.enabled=false",
        "cloudcoffee.payment.processing.max-attempts=3",
        "cloudcoffee.payment.processing.retry-backoff=PT10S",
        "cloudcoffee.payment.processing.max-backoff=PT1M",
        "cloudcoffee.payment.processing.lease=PT1M",
        "cloudcoffee.payment.processing.reconciliation-interval=PT2M",
        "cloudcoffee.payment.processing.expiry-grace=PT5M",
        "cloudcoffee.payment.processing.late-approval-window=P3D"})
@AutoConfigureMockMvc
class PagosIntegrationTests extends JwtTestSupport {

    static final String SECRETO = "secreto-webhook-de-prueba";
    static final String WEBHOOK = "/payments/webhooks/mercadopago";
    static final Instant INICIO = Instant.parse("2026-11-13T15:00:00Z");
    static final Instant EXPIRA = INICIO.plus(Duration.ofMinutes(15));

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired PagosControlados proveedor;
    @Autowired CanalControlado canal;
    @Autowired Reloj reloj;
    @Autowired ProcesadorPagos procesador;
    @Autowired PublicadorEventos publicador;
    final JsonMapper json = JsonMapper.builder().build();

    UUID intencion;
    String referencia;

    @TestConfiguration
    static class Controlados {
        @Bean @Primary PagosControlados pagosControlados() { return new PagosControlados(); }
        @Bean @Primary CanalControlado canalControlado() { return new CanalControlado(); }
        @Bean @Primary Reloj reloj() { return new Reloj(); }
    }

    static class Reloj extends Clock {
        volatile Instant ahora = INICIO;
        void avanzar(Duration d) { ahora = ahora.plus(d); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return ahora; }
    }

    // En el job PostgreSQL de CI todos los contextos comparten la base: no dejar filas para otras clases.
    @AfterEach
    void borrar() {
        for (String tabla : List.of("payment_outbox", "payment_inbox", "payment_anomaly", "provider_payment",
                "payment_preference", "payment_intent")) {
            jdbc.update("DELETE FROM " + tabla);
        }
    }

    @BeforeEach
    void preparar() {
        borrar();
        proveedor.reiniciar();
        canal.reiniciar();
        reloj.ahora = INICIO;
        intencion = intencionPendiente(4800, EXPIRA);
        referencia = intencion.toString();
    }

    // ------------------------------------------------------------------ utilidades

    /** Intención con preferencia confirmada (como la deja INT2-111), versión 2. */
    UUID intencionPendiente(long monto, Instant expira) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO payment_intent (id, compra_id, cliente_id, idempotency_key, request_hash, request_payload, amount,
                    currency, provider, environment, external_reference, return_channel, status, expires_at, created_at,
                    updated_at, version)
                VALUES (?, ?, ?, ?, ?, '{}', ?, 'CLP', 'mercadopago_sandbox', 'sandbox', ?, 'web', 'PENDING', ?, ?, ?, 2)
                """, id, UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "a".repeat(64), monto, id.toString(),
                utc(expira), utc(INICIO), utc(INICIO));
        jdbc.update("INSERT INTO payment_preference (id, payment_intent_id, provider_preference_id, init_point) VALUES (?, ?, ?, ?)",
                UUID.randomUUID(), id, "pref-" + id, "https://www.mercadopago.cl/checkout/v1/redirect?pref_id=pref-" + id);
        return id;
    }

    static OffsetDateTime utc(Instant instante) {
        return instante.atOffset(ZoneOffset.UTC);
    }

    PagoProveedor aprobado(String id, Instant aprobadoAt) {
        return PagosControlados.pago(id, "approved", referencia, "4800", "CLP", false, aprobadoAt, aprobadoAt);
    }

    PagoProveedor conEstado(String id, String estado, Instant actualizado) {
        return PagosControlados.pago(id, estado, referencia, "4800", "CLP", false, null, actualizado);
    }

    ResultActions webhook(String dataId, String notificacion) throws Exception {
        String requestId = UUID.randomUUID().toString();
        String ts = String.valueOf(reloj.ahora.toEpochMilli());
        String firma = "ts=" + ts + ",v1=" + FirmaWebhook.hmac(SECRETO, FirmaWebhook.manifiesto(dataId, requestId, ts));
        return webhook(dataId, firma, requestId, cuerpo(notificacion, dataId));
    }

    ResultActions webhook(String dataId, String firma, String requestId, String cuerpo) throws Exception {
        var request = post(WEBHOOK + "?data.id=" + dataId + "&type=payment").contentType(MediaType.APPLICATION_JSON)
                .content(cuerpo);
        if (firma != null) request.header("x-signature", firma);
        if (requestId != null) request.header("x-request-id", requestId);
        return mvc.perform(request);
    }

    static String cuerpo(String notificacion, String dataId) {
        return """
                {"id": %s, "live_mode": false, "type": "payment", "date_created": "2026-11-13T12:02:00.000-03:00",
                 "user_id": 44444, "api_version": "v1", "action": "payment.updated", "data": {"id": "%s"}}
                """.formatted(notificacion, dataId);
    }

    String estado() {
        return jdbc.queryForObject("SELECT status FROM payment_intent WHERE id = ?", String.class, intencion);
    }

    String motivo() {
        return jdbc.queryForObject("SELECT status_reason FROM payment_intent WHERE id = ?", String.class, intencion);
    }

    List<JsonNode> eventos() {
        return jdbc.queryForList("SELECT payload FROM payment_outbox WHERE payment_intent_id = ? ORDER BY aggregate_version",
                String.class, intencion).stream().map(json::readTree).toList();
    }

    int filas(String sql, Object... args) {
        return jdbc.queryForObject(sql, Integer.class, args);
    }

    /** Procesa el inbox hasta agotarlo. */
    void procesar() {
        while (procesador.procesarInbox() > 0) {
            // siguiente lote
        }
    }

    // ------------------------------------------------------------------ recepción del webhook

    @Test
    void signedNotificationIsPersistedWithoutJwtAndOnlySanitizedMetadata() throws Exception {
        webhook("1234567890", "\"notif-1\"")
                .andExpect(status().isAccepted())
                .andExpect(header().string("Cache-Control", "no-store"));
        var fila = jdbc.queryForMap("SELECT * FROM payment_inbox");
        assertThat(fila.get("notification_id")).isEqualTo("notif-1");
        assertThat(fila.get("provider_payment_id")).isEqualTo("1234567890");
        assertThat(fila.get("status")).isEqualTo("RECEIVED");
        assertThat((String) fila.get("trace_id")).matches("[0-9a-f]{32}");
        String payload = (String) fila.get("payload");
        assertThat(json.readTree(payload).path("action").asString()).isEqualTo("payment.updated");
        assertThat(payload).doesNotContain("v1=", SECRETO, "44444");
        // Recibir no consulta ni acredita nada: eso lo hace el procesamiento posterior.
        assertThat(proveedor.consultasHechas.get()).isZero();
        assertThat(estado()).isEqualTo("PENDING");
    }

    @Test
    void repeatedNotificationReturns200WithoutDuplicatingTheInbox() throws Exception {
        webhook("1234567890", "777").andExpect(status().isAccepted());
        // Un reintento del proveedor trae otro x-request-id y otra firma, con el mismo id de notificación.
        webhook("1234567890", "777").andExpect(status().isOk());
        assertThat(filas("SELECT COUNT(*) FROM payment_inbox")).isEqualTo(1);
    }

    @Test
    void invalidSignaturesAreRejectedWith401AndNothingIsPersisted() throws Exception {
        String ts = String.valueOf(reloj.ahora.getEpochSecond());
        String firmaOtroSecreto = "ts=" + ts + ",v1=" + FirmaWebhook.hmac("otro", FirmaWebhook.manifiesto("1", "r", ts));
        webhook("1", firmaOtroSecreto, "r", cuerpo("1", "1"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith("application/problem+json"))
                .andExpect(jsonPath("$.code").value("FIRMA_INVALIDA"));
        // Firma válida para otro pago: data.id alterado en la URL.
        String firmaDeOtroPago = "ts=" + ts + ",v1=" + FirmaWebhook.hmac(SECRETO, FirmaWebhook.manifiesto("2", "r", ts));
        webhook("1", firmaDeOtroPago, "r", cuerpo("1", "1")).andExpect(status().isUnauthorized());
        // Firma válida pero vieja (repetición fuera de la tolerancia).
        String viejo = String.valueOf(reloj.ahora.minus(Duration.ofMinutes(10)).getEpochSecond());
        String firmaVieja = "ts=" + viejo + ",v1=" + FirmaWebhook.hmac(SECRETO, FirmaWebhook.manifiesto("1", "r", viejo));
        webhook("1", firmaVieja, "r", cuerpo("1", "1")).andExpect(status().isUnauthorized());
        // Sin cabeceras.
        webhook("1", null, null, cuerpo("1", "1")).andExpect(status().isUnauthorized());
        webhook("1", "ts=" + ts + ",v1=" + "0".repeat(64), null, cuerpo("1", "1")).andExpect(status().isUnauthorized());
        assertThat(filas("SELECT COUNT(*) FROM payment_inbox")).isZero();
    }

    @Test
    void contractViolationsAreRejectedWith400() throws Exception {
        String requestId = "r";
        String ts = String.valueOf(reloj.ahora.getEpochSecond());
        String firma = "ts=" + ts + ",v1=" + FirmaWebhook.hmac(SECRETO, FirmaWebhook.manifiesto("1", requestId, ts));
        // El cuerpo debe referirse al mismo pago firmado en la URL.
        webhook("1", firma, requestId, cuerpo("9", "2")).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("NOTIFICACION_INVALIDA"));
        webhook("1", firma, requestId, "no-json").andExpect(status().isBadRequest());
        webhook("1", firma, requestId, "[]").andExpect(status().isBadRequest());
        webhook("1", firma, requestId, cuerpo("9", "1").replace("\"type\": \"payment\"", "\"type\": \"merchant_order\""))
                .andExpect(status().isBadRequest());
        webhook("1", firma, requestId, cuerpo("\"\"", "1")).andExpect(status().isBadRequest());
        webhook("1", firma, requestId, "{\"id\":9,\"type\":\"payment\",\"data\":{\"id\":\"1\"},\"x\":\""
                + "a".repeat(RecepcionWebhook.MAXIMO_CUERPO) + "\"}").andExpect(status().isBadRequest());
        mvc.perform(post(WEBHOOK + "?type=payment").header("x-signature", firma).header("x-request-id", requestId)
                .contentType(MediaType.APPLICATION_JSON).content(cuerpo("9", "1"))).andExpect(status().isBadRequest());
        mvc.perform(post(WEBHOOK + "?data.id=1&type=merchant_order").header("x-signature", firma)
                .header("x-request-id", requestId).contentType(MediaType.APPLICATION_JSON).content(cuerpo("9", "1")))
                .andExpect(status().isBadRequest());
        assertThat(filas("SELECT COUNT(*) FROM payment_inbox")).isZero();
    }

    // ------------------------------------------------------------------ aplicación del resultado

    @Test
    void approvedPaymentInTimeApprovesTheIntentAndWritesAContractCompliantEvent() throws Exception {
        Instant aprobado = INICIO.plus(Duration.ofMinutes(2));
        proveedor.publicar(aprobado("1234567890", aprobado));
        webhook("1234567890", "1").andExpect(status().isAccepted());
        procesar();

        assertThat(estado()).isEqualTo("APPROVED");
        assertThat(motivo()).isEqualTo("proveedor_confirmado");
        assertThat(jdbc.queryForObject("SELECT status FROM payment_inbox", String.class)).isEqualTo("PROCESSED");
        assertThat(filas("SELECT COUNT(*) FROM provider_payment WHERE provider_payment_id = '1234567890'")).isEqualTo(1);
        var eventos = eventos();
        assertThat(eventos).hasSize(1);
        JsonNode evento = eventos.getFirst();
        cumpleElEsquema(evento);
        JsonNode payload = evento.path("payload");
        assertThat(payload.path("estado").asString()).isEqualTo("aprobado");
        assertThat(payload.path("motivo").asString()).isEqualTo("proveedor_confirmado");
        assertThat(payload.path("paymentId").asString()).isEqualTo(intencion.toString());
        assertThat(payload.path("proveedorPagoId").asString()).isEqualTo("1234567890");
        assertThat(payload.path("preferenciaId").asString()).isEqualTo("pref-" + intencion);
        assertThat(payload.path("montoTotal").asLong()).isEqualTo(4800);
        assertThat(payload.path("version").asLong()).isEqualTo(3);
        assertThat(Instant.parse(payload.path("ocurridoAt").asString())).isEqualTo(aprobado);
        assertThat(evento.path("traceId").asString())
                .isEqualTo(jdbc.queryForObject("SELECT trace_id FROM payment_inbox", String.class));
        // La consulta GET interna refleja el resultado sin llamar al proveedor.
        mvc.perform(get("/internal/servicios/payments/preferencias/" + compra())
                        .header("X-Internal-Service-Token", INTERNAL_TOKEN))
                .andExpect(status().isOk()).andExpect(jsonPath("$.estado").value("aprobado"))
                .andExpect(jsonPath("$.version").value(3));
    }

    UUID compra() {
        return jdbc.queryForObject("SELECT compra_id FROM payment_intent WHERE id = ?", UUID.class, intencion);
    }

    @Test
    void foreignReferenceIsKeptAsEvidenceWithoutTouchingAnyIntent() throws Exception {
        proveedor.publicar(PagosControlados.pago("555", "approved", "referencia-de-otro-sistema", "4800", "CLP", false,
                INICIO, INICIO));
        webhook("555", "1").andExpect(status().isAccepted());
        procesar();
        assertThat(estado()).isEqualTo("PENDING");
        assertThat(eventos()).isEmpty();
        assertThat(jdbc.queryForObject("SELECT last_error_code FROM payment_inbox", String.class)).isEqualTo("REFERENCIA_AJENA");
        assertThat(jdbc.queryForObject("SELECT reason FROM payment_anomaly WHERE provider_payment_id = '555'", String.class))
                .isEqualTo("referencia_ajena");
    }

    @Test
    void amountCurrencyOrEnvironmentMismatchRequiresReconciliationAndPreservesEvidence() throws Exception {
        proveedor.publicar(PagosControlados.pago("10", "approved", referencia, "4700", "CLP", false, INICIO, INICIO));
        webhook("10", "1").andExpect(status().isAccepted());
        procesar();
        assertThat(estado()).isEqualTo("REQUIRES_RECONCILIATION");
        assertThat(motivo()).isEqualTo("monto_discrepante");
        assertThat(eventos()).singleElement().satisfies(e -> {
            cumpleElEsquema(e);
            assertThat(e.path("payload").path("estado").asString()).isEqualTo("requiere_conciliacion");
            assertThat(e.path("payload").path("motivo").asString()).isEqualTo("monto_discrepante");
        });
        // Nunca se registra como pago válido de la intención; queda la evidencia saneada.
        assertThat(filas("SELECT COUNT(*) FROM provider_payment")).isZero();
        assertThat(jdbc.queryForObject("SELECT evidence FROM payment_anomaly WHERE provider_payment_id = '10'", String.class))
                .contains("4700");

        UUID otra = intencionPendiente(4800, EXPIRA);
        proveedor.publicar(PagosControlados.pago("11", "approved", otra.toString(), "4800.5", "USD", true, INICIO, INICIO));
        webhook("11", "2").andExpect(status().isAccepted());
        procesar();
        assertThat(jdbc.queryForObject("SELECT status FROM payment_intent WHERE id = ?", String.class, otra))
                .isEqualTo("REQUIRES_RECONCILIATION");
        assertThat(jdbc.queryForList("SELECT reason FROM payment_anomaly WHERE provider_payment_id = '11'", String.class))
                .containsExactlyInAnyOrder("moneda_discrepante", "entorno_discrepante", "monto_discrepante");
    }

    @Test
    void rejectedOrCancelledPaymentWithWrongAmountIsOnlyEvidence() throws Exception {
        proveedor.publicar(PagosControlados.pago("12", "rejected", referencia, "1", "CLP", false, null, INICIO));
        webhook("12", "1");
        procesar();
        assertThat(estado()).isEqualTo("PENDING");
        assertThat(filas("SELECT COUNT(*) FROM payment_anomaly WHERE reason = 'monto_discrepante'")).isEqualTo(1);
    }

    @Test
    void rejectionAndCancellationCloseTheIntentOnce() throws Exception {
        proveedor.publicar(conEstado("20", "rejected", INICIO.plus(Duration.ofMinutes(1))));
        webhook("20", "1");
        webhook("20", "2");
        procesar();
        assertThat(estado()).isEqualTo("REJECTED");
        assertThat(eventos()).extracting(e -> e.path("payload").path("estado").asString()).containsExactly("rechazado");

        UUID otra = intencionPendiente(4800, EXPIRA);
        proveedor.publicar(PagosControlados.pago("21", "cancelled", otra.toString(), "4800", "CLP", false, null, INICIO));
        webhook("21", "3");
        procesar();
        assertThat(jdbc.queryForObject("SELECT status FROM payment_intent WHERE id = ?", String.class, otra)).isEqualTo("CANCELLED");
    }

    @Test
    void repeatedAndOutOfOrderNotificationsNeverRegressStateOrDuplicateEffects() throws Exception {
        Instant aprobado = INICIO.plus(Duration.ofMinutes(3));
        proveedor.publicar(aprobado("30", aprobado));
        webhook("30", "1");
        procesar();
        assertThat(estado()).isEqualTo("APPROVED");

        // Llega tarde la notificación de "pendiente" (otro id de notificación). El proveedor podría servir una
        // réplica atrasada: la observación más vieja no hace retroceder nada.
        proveedor.publicar(conEstado("30", "in_process", INICIO.plus(Duration.ofMinutes(1))));
        webhook("30", "0");
        procesar();
        assertThat(jdbc.queryForObject("SELECT provider_status FROM provider_payment WHERE provider_payment_id = '30'",
                String.class)).isEqualTo("approved");
        // Notificaciones repetidas del mismo pago ya aplicado.
        proveedor.publicar(aprobado("30", aprobado));
        webhook("30", "2");
        webhook("30", "3");
        // Un intento rechazado o cancelado que se notifica después no deshace la aprobación.
        proveedor.publicar(conEstado("32", "rejected", INICIO.plus(Duration.ofMinutes(4))));
        proveedor.publicar(conEstado("33", "cancelled", INICIO.plus(Duration.ofMinutes(5))));
        webhook("32", "4");
        webhook("33", "5");
        procesar();
        assertThat(estado()).isEqualTo("APPROVED");
        assertThat(eventos()).hasSize(1);
        assertThat(filas("SELECT COUNT(*) FROM payment_inbox WHERE status = 'PROCESSED'")).isEqualTo(6);
    }

    @Test
    void pendingObservationsDoNotEmitEvents() throws Exception {
        proveedor.publicar(conEstado("31", "in_process", INICIO));
        webhook("31", "1");
        procesar();
        assertThat(estado()).isEqualTo("PENDING");
        assertThat(eventos()).isEmpty();
        assertThat(filas("SELECT COUNT(*) FROM provider_payment")).isEqualTo(1);
    }

    @Test
    void approvalAfterExpiryRequiresReconciliationEvenIfNotifiedInOrder() throws Exception {
        Instant tarde = EXPIRA.plus(Duration.ofMinutes(1));
        proveedor.publicar(aprobado("40", tarde));
        reloj.ahora = tarde.plusSeconds(5);
        webhook("40", "1");
        procesar();
        assertThat(estado()).isEqualTo("REQUIRES_RECONCILIATION");
        assertThat(motivo()).isEqualTo("aprobacion_tardia");
        assertThat(eventos()).singleElement().satisfies(e -> {
            cumpleElEsquema(e);
            assertThat(e.path("payload").path("motivo").asString()).isEqualTo("aprobacion_tardia");
        });
    }

    @Test
    void lateArrivalOfAnInTimeApprovalAfterLocalExpiryRequiresReconciliation() throws Exception {
        // Vence localmente: el proveedor no muestra pagos.
        reloj.ahora = EXPIRA.plusSeconds(1);
        procesador.conciliarIntenciones();
        assertThat(estado()).isEqualTo("EXPIRED");
        assertThat(eventos()).singleElement().satisfies(e -> {
            cumpleElEsquema(e);
            assertThat(e.path("payload").path("estado").asString()).isEqualTo("vencido");
            assertThat(e.path("payload").path("proveedorPagoId").isNull()).isTrue();
        });
        // Llega una aprobación con fecha dentro del plazo, pero Order ya liberó las reservas.
        proveedor.publicar(aprobado("41", EXPIRA.minusSeconds(30)));
        reloj.avanzar(Duration.ofMinutes(1));
        webhook("41", "1");
        procesar();
        assertThat(estado()).isEqualTo("REQUIRES_RECONCILIATION");
        assertThat(motivo()).isEqualTo("aprobacion_tras_vencimiento");
        assertThat(eventos()).hasSize(2);
    }

    @Test
    void doubleApprovalOfTheSamePreferenceIsAnAnomalyNotTwoFulfillments() throws Exception {
        proveedor.publicar(aprobado("50", INICIO.plus(Duration.ofMinutes(1))));
        webhook("50", "1");
        procesar();
        proveedor.publicar(aprobado("51", INICIO.plus(Duration.ofMinutes(2))));
        webhook("51", "2");
        procesar();
        assertThat(estado()).isEqualTo("REQUIRES_RECONCILIATION");
        assertThat(motivo()).isEqualTo("doble_aprobacion");
        assertThat(eventos()).extracting(e -> e.path("payload").path("estado").asString())
                .containsExactly("aprobado", "requiere_conciliacion");
    }

    @Test
    void refundOrChargebackAfterApprovalRequiresReconciliation() throws Exception {
        proveedor.publicar(aprobado("60", INICIO.plus(Duration.ofMinutes(1))));
        webhook("60", "1");
        procesar();
        proveedor.publicar(PagosControlados.pago("60", "refunded", referencia, "4800", "CLP", false,
                INICIO.plus(Duration.ofMinutes(1)), INICIO.plus(Duration.ofMinutes(9))));
        webhook("60", "2");
        procesar();
        assertThat(estado()).isEqualTo("REQUIRES_RECONCILIATION");
        assertThat(motivo()).isEqualTo("reembolsado");
    }

    // ------------------------------------------------------------------ fallos del proveedor y reintentos

    @Test
    void providerOutageIsRetriedWithBackoffAndThenApplied() throws Exception {
        proveedor.caido = true;
        proveedor.publicar(aprobado("70", INICIO.plus(Duration.ofMinutes(1))));
        webhook("70", "1").andExpect(status().isAccepted());
        procesar();
        var fila = jdbc.queryForMap("SELECT status, attempts, last_error_code, next_attempt_at FROM payment_inbox");
        assertThat(fila.get("status")).isEqualTo("RECEIVED");
        assertThat(fila.get("attempts")).isEqualTo(1);
        assertThat(fila.get("last_error_code")).isEqualTo("PROVEEDOR_NO_DISPONIBLE");
        assertThat(estado()).isEqualTo("PENDING");
        // Antes del backoff no se reintenta.
        reloj.avanzar(Duration.ofSeconds(5));
        assertThat(procesador.procesarInbox()).isZero();

        proveedor.caido = false;
        reloj.avanzar(Duration.ofSeconds(6));
        procesar();
        assertThat(estado()).isEqualTo("APPROVED");
        assertThat(jdbc.queryForObject("SELECT status FROM payment_inbox", String.class)).isEqualTo("PROCESSED");
    }

    @Test
    void notificationsThatExhaustRetriesStayAsDeadEvidence() throws Exception {
        webhook("404", "1");
        for (int i = 0; i < 5; i++) {
            procesar();
            reloj.avanzar(Duration.ofMinutes(2));
        }
        var fila = jdbc.queryForMap("SELECT status, attempts, last_error_code FROM payment_inbox");
        assertThat(fila.get("status")).isEqualTo("DEAD");
        assertThat(fila.get("attempts")).isEqualTo(3);
        assertThat(fila.get("last_error_code")).isEqualTo("PAGO_NO_ENCONTRADO");
    }

    @Test
    void paymentForAnIntentWithoutConfirmedPreferenceWaitsInsteadOfBeingLost() throws Exception {
        jdbc.update("DELETE FROM payment_preference WHERE payment_intent_id = ?", intencion);
        jdbc.update("UPDATE payment_intent SET status = 'REQUIRES_RECONCILIATION' WHERE id = ?", intencion);
        proveedor.publicar(aprobado("80", INICIO.plus(Duration.ofMinutes(1))));
        webhook("80", "1");
        procesar();
        assertThat(jdbc.queryForObject("SELECT last_error_code FROM payment_inbox", String.class)).isEqualTo("PREFERENCIA_PENDIENTE");
        assertThat(jdbc.queryForObject("SELECT status FROM payment_inbox", String.class)).isEqualTo("RECEIVED");
        assertThat(filas("SELECT COUNT(*) FROM provider_payment")).isZero();

        // INT2-111 concilia la preferencia; el reintento ya puede aplicar el pago.
        jdbc.update("INSERT INTO payment_preference (id, payment_intent_id, provider_preference_id, init_point) VALUES (?, ?, ?, ?)",
                UUID.randomUUID(), intencion, "pref-" + intencion, "https://www.mercadopago.cl/checkout");
        jdbc.update("UPDATE payment_intent SET status = 'PENDING' WHERE id = ?", intencion);
        reloj.avanzar(Duration.ofSeconds(11));
        procesar();
        assertThat(estado()).isEqualTo("APPROVED");
    }

    @Test
    void concurrentWorkersAfterARestartProcessEachNotificationOnce() throws Exception {
        proveedor.publicar(aprobado("90", INICIO.plus(Duration.ofMinutes(1))));
        for (int i = 0; i < 5; i++) webhook("90", String.valueOf(100 + i)).andExpect(status().isAccepted());
        proveedor.demoraMs = 50;
        ExecutorService pool = Executors.newFixedThreadPool(4);
        try {
            CountDownLatch salida = new CountDownLatch(1);
            List<Future<Integer>> trabajos = new ArrayList<>();
            for (int i = 0; i < 4; i++) {
                Callable<Integer> trabajo = () -> {
                    salida.await();
                    return procesador.procesarInbox();
                };
                trabajos.add(pool.submit(trabajo));
            }
            salida.countDown();
            int tomadas = 0;
            for (var trabajo : trabajos) tomadas += trabajo.get(10, TimeUnit.SECONDS);
            assertThat(tomadas).isEqualTo(5);
        } finally {
            pool.shutdownNow();
        }
        assertThat(proveedor.consultasHechas.get()).isEqualTo(5);
        assertThat(estado()).isEqualTo("APPROVED");
        assertThat(eventos()).hasSize(1);
        assertThat(filas("SELECT COUNT(*) FROM payment_inbox WHERE status = 'PROCESSED' AND attempts = 1")).isEqualTo(5);
    }

    @Test
    void aWorkerThatDiesMidProcessingIsResumedAfterTheLease() throws Exception {
        proveedor.publicar(aprobado("91", INICIO.plus(Duration.ofMinutes(1))));
        webhook("91", "1");
        // Simula un trabajador que reclamó la fila y cayó antes de terminar.
        var entrada = jdbc.queryForObject("SELECT id FROM payment_inbox", UUID.class);
        assertThat(jdbc.update("UPDATE payment_inbox SET attempts = 1, next_attempt_at = ? WHERE id = ?",
                utc(reloj.ahora.plus(Duration.ofMinutes(1))), entrada)).isEqualTo(1);
        assertThat(procesador.procesarInbox()).isZero();
        reloj.avanzar(Duration.ofMinutes(1));
        procesar();
        assertThat(estado()).isEqualTo("APPROVED");
    }

    // ------------------------------------------------------------------ conciliación periódica

    @Test
    void lostNotificationsAreRecoveredByPeriodicReconciliation() {
        proveedor.publicar(aprobado("100", INICIO.plus(Duration.ofMinutes(1))));
        reloj.avanzar(Duration.ofMinutes(2));
        assertThat(procesador.conciliarIntenciones()).isEqualTo(1);
        assertThat(estado()).isEqualTo("APPROVED");
        assertThat(eventos()).hasSize(1);
        // No se vuelve a consultar antes del intervalo configurado.
        assertThat(procesador.conciliarIntenciones()).isZero();
        reloj.avanzar(Duration.ofMinutes(2));
        assertThat(procesador.conciliarIntenciones()).isEqualTo(1);
        assertThat(eventos()).hasSize(1);
    }

    @Test
    void expiryWaitsForTheProviderUntilTheGracePeriodEnds() {
        proveedor.caido = true;
        reloj.ahora = EXPIRA.plusSeconds(1);
        procesador.conciliarIntenciones();
        assertThat(estado()).isEqualTo("PENDING");
        reloj.ahora = EXPIRA.plus(Duration.ofMinutes(5));
        procesador.conciliarIntenciones();
        assertThat(estado()).isEqualTo("EXPIRED");
        assertThat(motivo()).isEqualTo("reserva_vencida");
    }

    @Test
    void expiryAppliesAnInTimeApprovalFoundByTheFinalCheckInsteadOfExpiring() {
        proveedor.publicar(aprobado("110", EXPIRA.minusSeconds(10)));
        reloj.ahora = EXPIRA.plusSeconds(30);
        procesador.conciliarIntenciones();
        assertThat(estado()).isEqualTo("APPROVED");
        assertThat(eventos()).hasSize(1);
    }

    @Test
    void lateApprovalsAreSearchedOnlyWithinTheConfiguredWindow() {
        reloj.ahora = EXPIRA.plusSeconds(1);
        procesador.conciliarIntenciones();
        assertThat(estado()).isEqualTo("EXPIRED");
        proveedor.publicar(aprobado("120", EXPIRA.plus(Duration.ofHours(1))));
        reloj.ahora = EXPIRA.plus(Duration.ofHours(2));
        procesador.conciliarIntenciones();
        assertThat(estado()).isEqualTo("REQUIRES_RECONCILIATION");
        assertThat(motivo()).isEqualTo("aprobacion_tardia");

        UUID vieja = intencionPendiente(4800, EXPIRA);
        jdbc.update("UPDATE payment_intent SET status = 'EXPIRED' WHERE id = ?", vieja);
        reloj.ahora = EXPIRA.plus(Duration.ofDays(4));
        int busquedas = proveedor.busquedasHechas.get();
        procesador.conciliarIntenciones();
        assertThat(proveedor.busquedasHechas.get()).isEqualTo(busquedas);
    }

    // ------------------------------------------------------------------ outbox

    @Test
    void outboxPublishesWithTheStableEventIdAndRetriesTheSameEventWhenTheBrokerIsDown() throws Exception {
        proveedor.publicar(aprobado("130", INICIO.plus(Duration.ofMinutes(1))));
        webhook("130", "1");
        procesar();
        UUID eventId = jdbc.queryForObject("SELECT event_id FROM payment_outbox", UUID.class);

        canal.caidoCon = "BROKER_NO_DISPONIBLE";
        assertThat(publicador.publicarPendientes()).isEqualTo(1);
        var fila = jdbc.queryForMap("SELECT status, attempts, last_error_code FROM payment_outbox");
        assertThat(fila.get("status")).isEqualTo("PENDING");
        assertThat(fila.get("last_error_code")).isEqualTo("BROKER_NO_DISPONIBLE");
        assertThat(publicador.publicarPendientes()).isZero();

        canal.caidoCon = null;
        reloj.avanzar(Duration.ofSeconds(10));
        assertThat(publicador.publicarPendientes()).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT status FROM payment_outbox", String.class)).isEqualTo("PUBLISHED");
        assertThat(canal.enviados).extracting(CanalControlado.Enviado::eventId).containsOnly(eventId);
        var publicado = canal.enviados.getLast();
        assertThat(publicado.exchange()).isEqualTo("cloudcoffee.events");
        assertThat(publicado.routingKey()).isEqualTo("payment.pago.resultado.v1");
        assertThat(json.readTree(publicado.cuerpo()).path("eventId").asString()).isEqualTo(eventId.toString());
        // Publicado no se vuelve a enviar.
        reloj.avanzar(Duration.ofMinutes(5));
        assertThat(publicador.publicarPendientes()).isZero();
    }

    @Test
    void exhaustedEventsGoToTheDeadLetterQueueOnlyWhenTheBrokerConfirmsIt() throws Exception {
        proveedor.publicar(aprobado("140", INICIO.plus(Duration.ofMinutes(1))));
        webhook("140", "1");
        procesar();
        canal.respuestas.add(Envio.fallo("SIN_RUTA"));
        canal.respuestas.add(Envio.fallo("SIN_RUTA"));
        canal.respuestas.add(Envio.fallo("SIN_RUTA"));
        canal.respuestas.add(Envio.fallo("BROKER_NO_DISPONIBLE")); // la DLQ tampoco responde la primera vez
        canal.respuestas.add(Envio.fallo("SIN_RUTA"));
        for (int i = 0; i < 3; i++) {
            publicador.publicarPendientes();
            reloj.avanzar(Duration.ofMinutes(1));
        }
        // Sin confirmación de la DLQ el evento no se da por muerto: sigue pendiente y se reintenta.
        assertThat(jdbc.queryForObject("SELECT status FROM payment_outbox", String.class)).isEqualTo("PENDING");
        publicador.publicarPendientes();
        var fila = jdbc.queryForMap("SELECT status, last_error_code FROM payment_outbox");
        assertThat(fila.get("status")).isEqualTo("DEAD");
        assertThat(fila.get("last_error_code")).isEqualTo("SIN_RUTA");
        var dlq = canal.enviados.getLast();
        assertThat(dlq.exchange()).isEqualTo("cloudcoffee.dlx");
        assertThat(dlq.routingKey()).isEqualTo("payment.events.dlq");
        assertThat(dlq.motivoDlq()).isEqualTo("SIN_RUTA");
        assertThat(dlq.eventId()).isEqualTo(canal.enviados.getFirst().eventId());
    }

    @Test
    void eventsOfTheSameIntentArePublishedInVersionOrder() throws Exception {
        proveedor.publicar(aprobado("150", INICIO.plus(Duration.ofMinutes(1))));
        webhook("150", "1");
        procesar();
        proveedor.publicar(aprobado("151", INICIO.plus(Duration.ofMinutes(2))));
        webhook("151", "2");
        procesar();
        assertThat(eventos()).hasSize(2);
        canal.respuestas.add(Envio.fallo("BROKER_NO_DISPONIBLE"));
        publicador.publicarPendientes();
        // La versión 3 falló: la 4 no se adelanta.
        assertThat(canal.enviados).hasSize(1);
        assertThat(filas("SELECT COUNT(*) FROM payment_outbox WHERE status = 'PENDING'")).isEqualTo(2);
        reloj.avanzar(Duration.ofSeconds(10));
        publicador.publicarPendientes();
        publicador.publicarPendientes();
        assertThat(canal.enviados).extracting(e -> json.readTree(e.cuerpo()).path("payload").path("version").asLong())
                .containsExactly(3L, 3L, 4L);
    }

    // ------------------------------------------------------------------ contrato del evento

    /** Valida el evento contra docs/payment-service.eventos.json (campos exactos, requeridos y enums). */
    void cumpleElEsquema(JsonNode evento) {
        JsonNode esquema = json.readTree(new File("../docs/payment-service.eventos.json"));
        assertThat(nombres(evento)).isEqualTo(nombres(esquema.path("properties")));
        JsonNode payloadEsquema = esquema.path("properties").path("payload");
        JsonNode payload = evento.path("payload");
        assertThat(nombres(payload)).isEqualTo(nombres(payloadEsquema.path("properties")));
        assertThat(evento.path("eventType").asString()).isEqualTo("payment.pago.resultado.v1");
        assertThat(evento.path("traceId").asString()).matches("[0-9a-f]{32}");
        UUID.fromString(evento.path("eventId").asString());
        Instant.parse(evento.path("timestamp").asString());
        Instant.parse(payload.path("ocurridoAt").asString());
        Instant.parse(payload.path("expiraAt").asString());
        Set<String> estados = new HashSet<>();
        payloadEsquema.path("properties").path("estado").path("enum").forEach(e -> estados.add(e.asString()));
        assertThat(estados).contains(payload.path("estado").asString());
        assertThat(payload.path("version").asLong()).isGreaterThanOrEqualTo(1);
        assertThat(payload.path("montoTotal").isIntegralNumber()).isTrue();
    }

    static Set<String> nombres(JsonNode nodo) {
        Set<String> nombres = new HashSet<>();
        nodo.properties().forEach(e -> nombres.add(e.getKey()));
        return nombres;
    }
}
