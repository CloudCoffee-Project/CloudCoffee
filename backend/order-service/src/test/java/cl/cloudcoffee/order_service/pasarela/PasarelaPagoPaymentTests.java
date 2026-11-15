package cl.cloudcoffee.order_service.pasarela;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withResourceNotFound;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.net.SocketTimeoutException;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import cl.cloudcoffee.order_service.pasarela.PasarelaPago.CheckoutEncontrado;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago.CheckoutInexistente;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago.CheckoutListo;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago.CheckoutPendiente;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago.CheckoutRechazado;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago.ConsultaNoDisponible;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago.SolicitudCheckout;

/** Contrato HTTP con payment-service (INT2-111) contra un servidor simulado. */
class PasarelaPagoPaymentTests {

    static final String TOKEN = "token-interno-de-prueba-con-32-caracteres";
    static final UUID COMPRA = UUID.fromString("30000000-0000-4000-8000-000000000001");
    static final UUID CLAVE = UUID.fromString("70000000-0000-4000-8000-000000000001");
    static final String CUERPO = "{\"compraId\":\"" + COMPRA + "\"}";
    static final String PREFERENCIA = """
            {"paymentId":"91000000-0000-4000-8000-000000000001","compraId":"30000000-0000-4000-8000-000000000001",
             "clienteId":"10000000-0000-4000-8000-000000000001","preferenciaId":"pref-1",
             "referenciaExterna":"91000000-0000-4000-8000-000000000001","estado":"pendiente","montoTotal":4800,
             "moneda":"CLP","entorno":"sandbox","initPoint":"https://www.mercadopago.cl/checkout/v1/redirect?pref_id=pref-1",
             "expiraAt":"2026-11-13T15:15:00Z","version":2}
            """;

    MockRestServiceServer server;
    PasarelaPagoPayment pasarela;

    @BeforeEach
    void setUp() {
        var builder = RestClient.builder().baseUrl("http://payment.test");
        server = MockRestServiceServer.bindTo(builder).build();
        pasarela = new PasarelaPagoPayment(builder, TOKEN);
    }

    @Test
    void sendsTheFrozenPayloadWithTheInternalTokenAndStableKey() {
        server.expect(requestTo("http://payment.test/internal/servicios/payments/preferencias"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("X-Internal-Service-Token", TOKEN))
                .andExpect(header("Idempotency-Key", CLAVE.toString()))
                .andExpect(content().json(CUERPO))
                .andRespond(withStatus(HttpStatus.CREATED).contentType(MediaType.APPLICATION_JSON).body(PREFERENCIA));
        var checkout = ((CheckoutListo) pasarela.iniciarCheckout(new SolicitudCheckout(CLAVE, CUERPO))).checkout();
        assertThat(checkout.paymentId()).isEqualTo(UUID.fromString("91000000-0000-4000-8000-000000000001"));
        assertThat(checkout.preferenciaId()).isEqualTo("pref-1");
        assertThat(checkout.initPoint()).startsWith("https://www.mercadopago.cl/");
        assertThat(checkout.montoTotal()).isEqualTo(4800);
        server.verify();
    }

    @Test
    void ambiguousOrUnavailableResponsesAreRetriedNeverTreatedAsNotCreated() {
        server.expect(requestTo("http://payment.test/internal/servicios/payments/preferencias"))
                .andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE).contentType(MediaType.APPLICATION_PROBLEM_JSON)
                        .body("{\"code\":\"PAGO_EN_CONCILIACION\"}"));
        server.expect(requestTo("http://payment.test/internal/servicios/payments/preferencias")).andRespond(withServerError());
        server.expect(requestTo("http://payment.test/internal/servicios/payments/preferencias"))
                .andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS));
        server.expect(requestTo("http://payment.test/internal/servicios/payments/preferencias"))
                .andRespond(withStatus(HttpStatus.CREATED).contentType(MediaType.APPLICATION_JSON)
                        .body(PREFERENCIA.replace("https://www.mercadopago.cl", "http://evil.test")));
        assertThat(pasarela.iniciarCheckout(new SolicitudCheckout(CLAVE, CUERPO)))
                .isEqualTo(new CheckoutPendiente("PAGO_EN_CONCILIACION"));
        assertThat(pasarela.iniciarCheckout(new SolicitudCheckout(CLAVE, CUERPO))).isInstanceOf(CheckoutPendiente.class);
        assertThat(pasarela.iniciarCheckout(new SolicitudCheckout(CLAVE, CUERPO))).isInstanceOf(CheckoutPendiente.class);
        assertThat(pasarela.iniciarCheckout(new SolicitudCheckout(CLAVE, CUERPO))).isInstanceOf(CheckoutPendiente.class);
    }

    @Test
    void networkTimeoutIsAmbiguousAndRetriedWithTheSameKey() {
        // Payment pudo crear la preferencia antes de que se cortara la respuesta.
        server.expect(requestTo("http://payment.test/internal/servicios/payments/preferencias"))
                .andRespond(withException(new SocketTimeoutException("Read timed out")));
        assertThat(pasarela.iniciarCheckout(new SolicitudCheckout(CLAVE, CUERPO)))
                .isEqualTo(new CheckoutPendiente("PAYMENT_NO_DISPONIBLE"));
    }

    @Test
    void definitiveConflictsAreReportedWithTheirCode() {
        server.expect(requestTo("http://payment.test/internal/servicios/payments/preferencias"))
                .andRespond(withStatus(HttpStatus.CONFLICT).contentType(MediaType.APPLICATION_PROBLEM_JSON)
                        .body("{\"code\":\"RESERVA_VENCIDA\"}"));
        assertThat(pasarela.iniciarCheckout(new SolicitudCheckout(CLAVE, CUERPO)))
                .isEqualTo(new CheckoutRechazado("RESERVA_VENCIDA"));
    }

    @Test
    void queryReadsThePersistedIntentWithoutSideEffects() {
        server.expect(requestTo("http://payment.test/internal/servicios/payments/preferencias/" + COMPRA))
                .andExpect(method(HttpMethod.GET)).andExpect(header("X-Internal-Service-Token", TOKEN))
                .andRespond(withSuccess(PREFERENCIA.replace("\"pendiente\"", "\"aprobado\""), MediaType.APPLICATION_JSON));
        server.expect(requestTo("http://payment.test/internal/servicios/payments/preferencias/" + COMPRA))
                .andRespond(withResourceNotFound());
        server.expect(requestTo("http://payment.test/internal/servicios/payments/preferencias/" + COMPRA))
                .andRespond(withServerError());
        assertThat(((CheckoutEncontrado) pasarela.consultarCheckout(COMPRA)).checkout().estado()).isEqualTo("aprobado");
        assertThat(pasarela.consultarCheckout(COMPRA)).isInstanceOf(CheckoutInexistente.class);
        assertThat(pasarela.consultarCheckout(COMPRA)).isInstanceOf(ConsultaNoDisponible.class);
    }

    @Test
    void withoutAValidInternalTokenNothingIsSent() {
        var sinToken = new PasarelaPagoPayment(RestClient.builder().baseUrl("http://payment.test"), "corto");
        assertThat(sinToken.iniciarCheckout(new SolicitudCheckout(CLAVE, CUERPO))).isInstanceOf(CheckoutPendiente.class);
        assertThat(sinToken.consultarCheckout(COMPRA)).isInstanceOf(ConsultaNoDisponible.class);
    }
}
