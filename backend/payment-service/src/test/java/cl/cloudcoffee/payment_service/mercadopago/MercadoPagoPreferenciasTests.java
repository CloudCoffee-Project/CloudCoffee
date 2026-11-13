package cl.cloudcoffee.payment_service.mercadopago;

import java.io.IOException;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import cl.cloudcoffee.payment_service.config.PaymentProperties;
import cl.cloudcoffee.payment_service.mercadopago.ProveedorPreferencias.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;

/** Adaptador HTTP real contra un servidor controlado: payload exacto y clasificación de cada fallo. */
class MercadoPagoPreferenciasTests {

    static final UUID PAYMENT = UUID.fromString("91000000-0000-4000-8000-000000000001");
    static final UUID COMPRA = UUID.fromString("30000000-0000-4000-8000-000000000001");
    static final String REF = PAYMENT.toString();

    MockRestServiceServer server;

    MercadoPagoPreferencias adapter(String token, String mode) {
        var properties = new PaymentProperties("mercadopago_sandbox", Duration.ofSeconds(5), Duration.ofMinutes(5),
                token, "webhook-secret", URI.create("https://pagos.cloudcoffee.test/webhooks/mercadopago"),
                URI.create("https://app.cloudcoffee.test/pagos/retorno"),
                URI.create("https://app.cloudcoffee.test/m/pagos/retorno"), mode, null, null);
        RestClient.Builder builder = RestClient.builder();
        server = MockRestServiceServer.bindTo(builder).build();
        return new MercadoPagoPreferencias(properties, builder);
    }

    NuevaPreferencia nueva() {
        return new NuevaPreferencia(PAYMENT, COMPRA, REF, List.of(
                new Item(UUID.fromString("50000000-0000-4000-8000-000000000001"),
                        UUID.fromString("40000000-0000-4000-8000-000000000001"), "Café americano", 2, 1800),
                new Item(UUID.fromString("50000000-0000-4000-8000-000000000002"),
                        UUID.fromString("40000000-0000-4000-8000-000000000002"), "Té", 1, 1200)),
                Instant.parse("2026-11-13T15:15:00Z"),
                URI.create("https://app.cloudcoffee.test/pagos/retorno?compraId=" + COMPRA + "&resultado=exito"),
                URI.create("https://app.cloudcoffee.test/pagos/retorno?compraId=" + COMPRA + "&resultado=pendiente"),
                URI.create("https://app.cloudcoffee.test/pagos/retorno?compraId=" + COMPRA + "&resultado=fallo"));
    }

    static String preferencia(String id, String ref) {
        return """
                {"id":"%s","external_reference":"%s",
                 "init_point":"https://www.mercadopago.cl/checkout/v1/redirect?pref_id=%s",
                 "sandbox_init_point":"https://sandbox.mercadopago.cl/checkout/v1/redirect?pref_id=%s"}
                """.formatted(id, ref, id, id);
    }

    @Test
    void createsPreferenceWithBackendAmountsTrustedUrlsAndStableReference() {
        var adapter = adapter("APP_USR-secret", "test-user");
        server.expect(requestTo("https://api.mercadopago.com/checkout/preferences"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("Authorization", "Bearer APP_USR-secret"))
                .andExpect(header("X-Idempotency-Key", PAYMENT.toString()))
                .andExpect(jsonPath("$.external_reference").value(REF))
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[0].id").value("50000000-0000-4000-8000-000000000001"))
                .andExpect(jsonPath("$.items[0].quantity").value(2))
                .andExpect(jsonPath("$.items[0].unit_price").value(1800))
                .andExpect(jsonPath("$.items[0].currency_id").value("CLP"))
                .andExpect(jsonPath("$.items[1].unit_price").value(1200))
                .andExpect(jsonPath("$.back_urls.success").value(endsWith("resultado=exito")))
                .andExpect(jsonPath("$.back_urls.pending").value(endsWith("resultado=pendiente")))
                .andExpect(jsonPath("$.back_urls.failure").value(endsWith("resultado=fallo")))
                .andExpect(jsonPath("$.auto_return").value("approved"))
                .andExpect(jsonPath("$.notification_url").value("https://pagos.cloudcoffee.test/webhooks/mercadopago"))
                .andExpect(jsonPath("$.expires").value(true))
                .andExpect(jsonPath("$.expiration_date_to").value("2026-11-13T15:15:00.000+00:00"))
                .andExpect(jsonPath("$.metadata.compra_id").value(COMPRA.toString()))
                .andRespond(withStatus(HttpStatus.CREATED).contentType(MediaType.APPLICATION_JSON)
                        .body(preferencia("pref-1", REF)));

        var resultado = adapter.crear(nueva());

        assertThat(resultado).isInstanceOf(Creada.class);
        var preferencia = ((Creada) resultado).preferencia();
        assertThat(preferencia.id()).isEqualTo("pref-1");
        // Usuario vendedor de prueba: el checkout es init_point.
        assertThat(preferencia.checkout().toString()).startsWith("https://www.mercadopago.cl/");
        server.verify();
    }

    @Test
    void testCredentialsUseSandboxInitPoint() {
        var adapter = adapter("TEST-secret", "test-credentials");
        server.expect(requestTo("https://api.mercadopago.com/checkout/preferences"))
                .andRespond(withStatus(HttpStatus.CREATED).contentType(MediaType.APPLICATION_JSON)
                        .body(preferencia("pref-1", REF)));
        var resultado = (Creada) adapter.crear(nueva());
        assertThat(resultado.preferencia().checkout().toString()).startsWith("https://sandbox.mercadopago.cl/");
    }

    @Test
    void definitiveRejectionMeansNothingWasCreated() {
        var adapter = adapter("APP_USR-secret", "test-user");
        server.expect(requestTo("https://api.mercadopago.com/checkout/preferences"))
                .andRespond(withStatus(HttpStatus.BAD_REQUEST).body("{\"message\":\"invalid\"}"));
        assertThat(adapter.crear(nueva())).isInstanceOf(NoCreada.class);
    }

    @Test
    void connectionNeverEstablishedMeansNothingWasCreated() {
        var adapter = adapter("APP_USR-secret", "test-user");
        server.expect(requestTo("https://api.mercadopago.com/checkout/preferences"))
                .andRespond(withException(new ConnectException("Connection refused")));
        assertThat(adapter.crear(nueva())).isInstanceOf(NoCreada.class);
    }

    @Test
    void timeoutsServerErrorsThrottlingAndUnverifiableResponsesAreUncertain() {
        assertUncertain(withException(new SocketTimeoutException("Read timed out")));
        assertUncertain(withException(new IOException("Connection reset")));
        assertUncertain(withServerError());
        assertUncertain(withStatus(HttpStatus.TOO_MANY_REQUESTS));
        assertUncertain(withStatus(HttpStatus.CREATED).contentType(MediaType.APPLICATION_JSON).body("no-json"));
        assertUncertain(withStatus(HttpStatus.CREATED).contentType(MediaType.APPLICATION_JSON)
                .body(preferencia("pref-1", "otra-referencia")));
        assertUncertain(withStatus(HttpStatus.CREATED).contentType(MediaType.APPLICATION_JSON)
                .body("{\"id\":\"pref-1\",\"external_reference\":\"" + REF + "\",\"init_point\":\"http://inseguro.test/x\"}"));
    }

    private void assertUncertain(org.springframework.test.web.client.ResponseCreator response) {
        var adapter = adapter("APP_USR-secret", "test-user");
        server.expect(requestTo("https://api.mercadopago.com/checkout/preferences")).andRespond(response);
        assertThat(adapter.crear(nueva())).isInstanceOf(Incierta.class);
    }

    @Test
    void searchFindsThePreferenceByExternalReferenceAndReadsItsCheckout() {
        var adapter = adapter("APP_USR-secret", "test-user");
        server.expect(requestTo("https://api.mercadopago.com/checkout/preferences/search?external_reference=" + REF))
                .andExpect(method(HttpMethod.GET))
                .andExpect(header("Authorization", "Bearer APP_USR-secret"))
                .andRespond(withSuccess("{\"elements\":[{\"id\":\"pref-1\",\"external_reference\":\"" + REF
                        + "\"},{\"id\":\"pref-x\",\"external_reference\":\"otra\"}],\"total\":2}", MediaType.APPLICATION_JSON));
        server.expect(requestTo("https://api.mercadopago.com/checkout/preferences/pref-1"))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess(preferencia("pref-1", REF), MediaType.APPLICATION_JSON));

        var busqueda = adapter.buscar(REF);

        assertThat(busqueda).isInstanceOf(Encontradas.class);
        var encontradas = ((Encontradas) busqueda).preferencias();
        assertThat(encontradas).singleElement().satisfies(p -> {
            assertThat(p.id()).isEqualTo("pref-1");
            assertThat(p.checkout()).isNotNull();
        });
        server.verify();
    }

    @Test
    void emptySearchAndFailedSearchAreDistinguished() {
        var adapter = adapter("APP_USR-secret", "test-user");
        server.expect(requestTo("https://api.mercadopago.com/checkout/preferences/search?external_reference=" + REF))
                .andRespond(withSuccess("{\"elements\":[],\"total\":0}", MediaType.APPLICATION_JSON));
        assertThat(adapter.buscar(REF)).isEqualTo(new Encontradas(List.of()));

        adapter = adapter("APP_USR-secret", "test-user");
        server.expect(requestTo("https://api.mercadopago.com/checkout/preferences/search?external_reference=" + REF))
                .andRespond(withServerError());
        assertThat(adapter.buscar(REF)).isInstanceOf(BusquedaFallida.class);

        adapter = adapter("APP_USR-secret", "test-user");
        server.expect(requestTo("https://api.mercadopago.com/checkout/preferences/search?external_reference=" + REF))
                .andRespond(withSuccess("{\"total\":0}", MediaType.APPLICATION_JSON));
        assertThat(adapter.buscar(REF)).isInstanceOf(BusquedaFallida.class);
    }
}
