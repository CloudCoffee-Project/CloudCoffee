package cl.cloudcoffee.payment_service.mercadopago;

import java.math.BigDecimal;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import cl.cloudcoffee.payment_service.config.PaymentProperties;
import cl.cloudcoffee.payment_service.mercadopago.ProveedorPagos.Encontrado;
import cl.cloudcoffee.payment_service.mercadopago.ProveedorPagos.Fallida;
import cl.cloudcoffee.payment_service.mercadopago.ProveedorPagos.NoEncontrado;
import cl.cloudcoffee.payment_service.mercadopago.ProveedorPagos.Pagos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;

class MercadoPagoPagosTests {

    static final String API = "https://api.mercadopago.test";
    MockRestServiceServer server;
    MercadoPagoPagos pagos;

    static final String PAGO = """
            {"id": 1234567890, "status": "approved", "status_detail": "accredited",
             "external_reference": "91000000-0000-4000-8000-000000000001", "transaction_amount": 4800,
             "currency_id": "CLP", "live_mode": false,
             "date_approved": "2026-11-13T12:02:00.000-03:00", "date_last_updated": "2026-11-13T12:02:01.000-03:00",
             "payer": {"email": "comprador@example.test", "identification": {"number": "11111111"}},
             "card": {"first_six_digits": "450995", "last_four_digits": "3704", "cardholder": {"name": "APRO"}}}
            """;

    @BeforeEach
    void setUp() {
        var properties = new PaymentProperties("mercadopago_sandbox", Duration.ofSeconds(5), Duration.ofMinutes(5),
                "APP_USR-token-de-prueba", "secreto", null, URI.create("https://app.test/r"),
                URI.create("https://app.test/m"), "test-user", URI.create(API), null);
        var builder = RestClient.builder();
        server = MockRestServiceServer.bindTo(builder).build();
        pagos = new MercadoPagoPagos(properties, builder);
    }

    @Test
    void readsOnlyTheFieldsNeededToReconcileAndNeverPayerOrCardData() {
        server.expect(requestTo(API + "/v1/payments/1234567890")).andExpect(method(HttpMethod.GET))
                .andExpect(header("Authorization", "Bearer APP_USR-token-de-prueba"))
                .andRespond(withSuccess(PAGO, MediaType.APPLICATION_JSON));
        var pago = ((Encontrado) pagos.consultar("1234567890")).pago();
        assertThat(pago.id()).isEqualTo("1234567890");
        assertThat(pago.estado()).isEqualTo("approved");
        assertThat(pago.referenciaExterna()).isEqualTo("91000000-0000-4000-8000-000000000001");
        assertThat(pago.monto()).isEqualByComparingTo(new BigDecimal("4800"));
        assertThat(pago.moneda()).isEqualTo("CLP");
        assertThat(pago.liveMode()).isFalse();
        assertThat(pago.aprobadoAt()).isEqualTo(Instant.parse("2026-11-13T15:02:00Z"));
        assertThat(pago.actualizadoAt()).isEqualTo(Instant.parse("2026-11-13T15:02:01Z"));
        assertThat(pago.evidencia()).contains("\"status\":\"approved\"")
                .doesNotContain("comprador@example.test", "11111111", "450995", "3704", "APRO", "token");
        server.verify();
    }

    @Test
    void notFoundIsDistinguishedFromAnUnavailableProvider() {
        server.expect(requestTo(API + "/v1/payments/1")).andRespond(withStatus(HttpStatus.NOT_FOUND));
        server.expect(requestTo(API + "/v1/payments/2")).andRespond(withServerError());
        server.expect(requestTo(API + "/v1/payments/3")).andRespond(withStatus(HttpStatus.UNAUTHORIZED));
        assertThat(pagos.consultar("1")).isInstanceOf(NoEncontrado.class);
        assertThat(pagos.consultar("2")).isInstanceOf(Fallida.class);
        assertThat(pagos.consultar("3")).isInstanceOf(Fallida.class);
    }

    @Test
    void incompleteOrMismatchedResourcesAreNotTrusted() {
        server.expect(requestTo(API + "/v1/payments/1")).andRespond(withSuccess(
                "{\"id\":1,\"status\":\"approved\",\"currency_id\":\"CLP\",\"date_created\":\"2026-11-13T15:00:00Z\"}",
                MediaType.APPLICATION_JSON));
        server.expect(requestTo(API + "/v1/payments/2")).andRespond(withSuccess(PAGO, MediaType.APPLICATION_JSON));
        server.expect(requestTo(API + "/v1/payments/3")).andRespond(withSuccess("no-json", MediaType.APPLICATION_JSON));
        assertThat(pagos.consultar("1")).isInstanceOf(Fallida.class);
        // El recurso devuelto debe ser el pago pedido.
        assertThat(pagos.consultar("2")).isInstanceOf(Fallida.class);
        assertThat(pagos.consultar("3")).isInstanceOf(Fallida.class);
    }

    @Test
    void decimalAmountsAndProductionPaymentsAreReportedAsTheyAre() {
        server.expect(requestTo(API + "/v1/payments/1234567890")).andRespond(withSuccess(
                PAGO.replace("\"transaction_amount\": 4800", "\"transaction_amount\": 4800.5")
                        .replace("\"live_mode\": false", "\"live_mode\": true"), MediaType.APPLICATION_JSON));
        var pago = ((Encontrado) pagos.consultar("1234567890")).pago();
        assertThat(pago.monto()).isEqualByComparingTo(new BigDecimal("4800.5"));
        assertThat(pago.liveMode()).isTrue();
    }

    @Test
    void searchesByExternalReferenceAndRejectsIncompletePages() {
        String ref = "91000000-0000-4000-8000-000000000001";
        server.expect(requestTo(API + "/v1/payments/search?external_reference=" + ref
                        + "&sort=date_created&criteria=asc&limit=100"))
                .andRespond(withSuccess("{\"paging\":{\"total\":2},\"results\":[" + PAGO + ","
                        + PAGO.replace(ref, "otra-referencia").replace("1234567890", "99") + "]}", MediaType.APPLICATION_JSON));
        var encontrados = ((Pagos) pagos.buscarPorReferencia(ref)).pagos();
        assertThat(encontrados).extracting(ProveedorPagos.PagoProveedor::id).containsExactly("1234567890");

        server.reset();
        server.expect(requestTo(API + "/v1/payments/search?external_reference=" + ref
                        + "&sort=date_created&criteria=asc&limit=100"))
                .andRespond(withSuccess("{\"paging\":{\"total\":150},\"results\":[" + PAGO + "]}", MediaType.APPLICATION_JSON));
        assertThat(pagos.buscarPorReferencia(ref)).isInstanceOf(Fallida.class);

        server.reset();
        server.expect(requestTo(API + "/v1/payments/search?external_reference=" + ref
                        + "&sort=date_created&criteria=asc&limit=100"))
                .andRespond(withServerError());
        assertThat(pagos.buscarPorReferencia(ref)).isInstanceOf(Fallida.class);
    }
}
