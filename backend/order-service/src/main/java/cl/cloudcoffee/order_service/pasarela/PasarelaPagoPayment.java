package cl.cloudcoffee.order_service.pasarela;

import java.time.Duration;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import cl.cloudcoffee.order_service.model.Pago;
import cl.cloudcoffee.security.InternalServiceAuthenticationFilter;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Adaptador de {@link PasarelaPago} hacia la API interna de payment-service (INT2-111):
 * {@code POST /internal/servicios/payments/preferencias} y su consulta por compra. Autenticado con el token
 * interno compartido; nunca envía el JWT del comprador. Activo con {@code ORDER_PAYMENT_PROVIDER=mercadopago_sandbox}.
 *
 * <p>Un 503, un timeout o una respuesta ilegible nunca se interpretan como "no se creó": se devuelve
 * {@link CheckoutPendiente} y el siguiente intento repite la misma clave y carga, que Payment deduplica.
 */
@Component
@ConditionalOnProperty(name = "cloudcoffee.pagos.provider", havingValue = "mercadopago_sandbox")
public class PasarelaPagoPayment implements PasarelaPago {

    static final String RUTA = "/internal/servicios/payments/preferencias";

    private final RestClient http;
    private final String token;
    private final JsonMapper json = JsonMapper.builder().build();

    @Autowired
    public PasarelaPagoPayment(@Value("${cloudcoffee.pagos.payment-url:${PAYMENT_SERVICE_URL:http://localhost:18085}}") String url,
            @Value("${cloudcoffee.internal.token:${INTERNAL_SERVICE_TOKEN:}}") String token,
            @Value("${cloudcoffee.pagos.payment-timeout:PT5S}") Duration timeout) {
        this(RestClient.builder().baseUrl(url).requestFactory(factory(timeout)), token);
    }

    PasarelaPagoPayment(RestClient.Builder builder, String token) {
        this.http = builder.build();
        this.token = token;
    }

    private static SimpleClientHttpRequestFactory factory(Duration timeout) {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(timeout);
        // Payment puede tardar su propio timeout con Mercado Pago más la conciliación: margen adicional.
        factory.setReadTimeout(timeout.multipliedBy(3));
        return factory;
    }

    @Override
    public String proveedor() {
        return Pago.PROVEEDOR_SANDBOX;
    }

    @Override
    public boolean esExterna() {
        return true;
    }

    @Override
    public RegistroPasarela registrar(SolicitudPago solicitud) {
        throw new UnsupportedOperationException("payment-service se inicia con iniciarCheckout");
    }

    @Override
    public Inicio iniciarCheckout(SolicitudCheckout solicitud) {
        if (token == null || token.length() < 32) return new CheckoutPendiente("TOKEN_INTERNO_NO_CONFIGURADO");
        String body;
        try {
            body = http.post().uri(RUTA)
                    .header(InternalServiceAuthenticationFilter.HEADER, token)
                    .header("Idempotency-Key", solicitud.claveIdempotencia().toString())
                    .contentType(MediaType.APPLICATION_JSON).accept(MediaType.APPLICATION_JSON)
                    .body(solicitud.cuerpo())
                    .retrieve().body(String.class);
        } catch (HttpClientErrorException error) {
            String codigo = codigo(error.getResponseBodyAsString());
            // 408/429 pueden llegar con la solicitud ya procesada: se reintenta con la misma clave.
            int status = error.getStatusCode().value();
            if (status == 408 || status == 429) return new CheckoutPendiente(codigo == null ? "HTTP " + status : codigo);
            return new CheckoutRechazado(codigo == null ? "HTTP " + status : codigo);
        } catch (HttpStatusCodeException error) {
            String codigo = codigo(error.getResponseBodyAsString());
            return new CheckoutPendiente(codigo == null ? "HTTP " + error.getStatusCode().value() : codigo);
        } catch (RestClientException error) {
            return new CheckoutPendiente("PAYMENT_NO_DISPONIBLE");
        }
        Checkout checkout = leer(body);
        if (checkout == null || checkout.initPoint() == null || checkout.preferenciaId() == null) {
            return new CheckoutPendiente("RESPUESTA_NO_VERIFICABLE");
        }
        return new CheckoutListo(checkout);
    }

    @Override
    public Consulta consultarCheckout(UUID compraId) {
        if (token == null || token.length() < 32) return new ConsultaNoDisponible("TOKEN_INTERNO_NO_CONFIGURADO");
        try {
            String body = http.get().uri(RUTA + "/{compraId}", compraId)
                    .header(InternalServiceAuthenticationFilter.HEADER, token)
                    .accept(MediaType.APPLICATION_JSON)
                    .retrieve().body(String.class);
            Checkout checkout = leer(body);
            if (checkout == null || !compraId.equals(checkout.compraId())) return new ConsultaNoDisponible("RESPUESTA_NO_VERIFICABLE");
            return new CheckoutEncontrado(checkout);
        } catch (HttpClientErrorException.NotFound noExiste) {
            return new CheckoutInexistente();
        } catch (RestClientException error) {
            return new ConsultaNoDisponible(error.getClass().getSimpleName());
        }
    }

    /** Recurso Preferencia del contrato 2.0.0; null si falta un campo obligatorio. */
    Checkout leer(String body) {
        try {
            JsonNode nodo = json.readTree(body == null ? "" : body);
            UUID paymentId = uuid(nodo.path("paymentId"));
            UUID compraId = uuid(nodo.path("compraId"));
            UUID clienteId = uuid(nodo.path("clienteId"));
            String estado = texto(nodo.path("estado"));
            JsonNode monto = nodo.path("montoTotal");
            JsonNode version = nodo.path("version");
            if (paymentId == null || compraId == null || clienteId == null || estado == null
                    || !monto.isIntegralNumber() || !version.isIntegralNumber()) {
                return null;
            }
            String initPoint = texto(nodo.path("initPoint"));
            if (initPoint != null && !initPoint.startsWith("https://")) return null;
            return new Checkout(paymentId, compraId, clienteId, texto(nodo.path("preferenciaId")), initPoint, estado,
                    monto.asLong(), version.asLong());
        } catch (JacksonException error) {
            return null;
        }
    }

    private String codigo(String body) {
        try {
            return texto(json.readTree(body == null ? "" : body).path("code"));
        } catch (JacksonException error) {
            return null;
        }
    }

    private static UUID uuid(JsonNode nodo) {
        try {
            return nodo.isString() ? UUID.fromString(nodo.asString()) : null;
        } catch (IllegalArgumentException error) {
            return null;
        }
    }

    private static String texto(JsonNode nodo) {
        return nodo.isString() && !nodo.asString().isBlank() ? nodo.asString() : null;
    }
}
