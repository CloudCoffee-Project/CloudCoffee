package cl.cloudcoffee.payment_service.mercadopago;

import java.net.ConnectException;
import java.net.URI;
import java.net.UnknownHostException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import cl.cloudcoffee.payment_service.config.PaymentProperties;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Adaptador HTTP de Checkout Pro (POST/GET /checkout/preferences y búsqueda por external_reference).
 *
 * <p>Envía {@code X-Idempotency-Key} con el ID de la intención como defensa adicional, pero el servicio no
 * depende de esa garantía: tras un resultado incierto concilia buscando por la referencia externa estable.
 * El access token solo viaja en el header Authorization y nunca se registra.
 */
@Component
public class MercadoPagoPreferencias implements ProveedorPreferencias {

    private static final Logger log = LoggerFactory.getLogger(MercadoPagoPreferencias.class);
    private static final DateTimeFormatter FECHA = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSxxx")
            .withZone(ZoneOffset.UTC);

    private final RestClient http;
    private final PaymentProperties properties;
    private final JsonMapper json = JsonMapper.builder().build();

    @Autowired
    public MercadoPagoPreferencias(PaymentProperties properties) {
        this(properties, RestClient.builder().requestFactory(factory(properties)));
    }

    MercadoPagoPreferencias(PaymentProperties properties, RestClient.Builder builder) {
        this.properties = properties;
        this.http = builder.baseUrl(properties.mercadopagoApiUrl().toString()).build();
    }

    static SimpleClientHttpRequestFactory factory(PaymentProperties properties) {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(properties.requestTimeout());
        factory.setReadTimeout(properties.requestTimeout());
        return factory;
    }

    @Override
    public Creacion crear(NuevaPreferencia preferencia) {
        String body;
        try {
            body = http.post().uri("/checkout/preferences")
                    .header("Authorization", "Bearer " + properties.accessToken())
                    .header("X-Idempotency-Key", preferencia.paymentId().toString())
                    .contentType(MediaType.APPLICATION_JSON)
                    .accept(MediaType.APPLICATION_JSON)
                    .body(cuerpo(preferencia))
                    .retrieve().body(String.class);
        } catch (HttpClientErrorException error) {
            int status = error.getStatusCode().value();
            // 408/429 pueden llegar después de procesar la solicitud: no prueban que no se creó.
            if (status == 408 || status == 429) return new Incierta("HTTP " + status);
            log.warn("Mercado Pago rechazó la preferencia de la intención {}: HTTP {}", preferencia.paymentId(), status);
            return new NoCreada("HTTP " + status);
        } catch (HttpStatusCodeException error) {
            return new Incierta("HTTP " + error.getStatusCode().value());
        } catch (ResourceAccessException error) {
            // Sin conexión establecida la solicitud nunca salió; cualquier otro error de E/S es ambiguo.
            return conexionNoEstablecida(error) ? new NoCreada("sin conexión") : new Incierta("E/S: " + error.getClass().getSimpleName());
        } catch (RestClientException error) {
            return new Incierta(error.getClass().getSimpleName());
        }
        Preferencia creada = leerPreferencia(body);
        if (creada == null || !preferencia.referenciaExterna().equals(creada.referenciaExterna()) || creada.checkout() == null) {
            // Hubo 2xx pero no podemos verificar el recurso: se concilia por referencia externa.
            return new Incierta("respuesta del proveedor no verificable");
        }
        return new Creada(creada);
    }

    @Override
    public Busqueda buscar(String referenciaExterna) {
        try {
            String body = http.get()
                    .uri(uri -> uri.path("/checkout/preferences/search").queryParam("external_reference", referenciaExterna).build())
                    .header("Authorization", "Bearer " + properties.accessToken())
                    .accept(MediaType.APPLICATION_JSON)
                    .retrieve().body(String.class);
            JsonNode elementos = json.readTree(body == null ? "" : body).path("elements");
            if (!elementos.isArray()) return new BusquedaFallida("respuesta de búsqueda sin elements");
            List<Preferencia> encontradas = new ArrayList<>();
            for (JsonNode elemento : elementos) {
                String id = texto(elemento, "id");
                // La búsqueda puede no devolver init_point: se lee el recurso completo y se verifica su referencia.
                if (id == null || !referenciaExterna.equals(texto(elemento, "external_reference"))) continue;
                Preferencia completa = leerPreferencia(http.get().uri("/checkout/preferences/{id}", id)
                        .header("Authorization", "Bearer " + properties.accessToken())
                        .accept(MediaType.APPLICATION_JSON)
                        .retrieve().body(String.class));
                if (completa == null || !id.equals(completa.id()) || !referenciaExterna.equals(completa.referenciaExterna())) {
                    return new BusquedaFallida("preferencia encontrada no verificable");
                }
                encontradas.add(completa);
            }
            return new Encontradas(List.copyOf(encontradas));
        } catch (RestClientException | JacksonException error) {
            return new BusquedaFallida(error.getClass().getSimpleName());
        }
    }

    private Map<String, Object> cuerpo(NuevaPreferencia preferencia) {
        List<Map<String, Object>> items = preferencia.items().stream().map(item -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", item.ofertaId().toString());
            m.put("title", item.titulo());
            m.put("description", "Orden " + item.ordenId());
            m.put("quantity", item.cantidad());
            m.put("unit_price", item.precioUnitario());
            m.put("currency_id", "CLP");
            return m;
        }).toList();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("items", items);
        body.put("external_reference", preferencia.referenciaExterna());
        body.put("back_urls", Map.of("success", preferencia.exito().toString(),
                "pending", preferencia.pendiente().toString(), "failure", preferencia.fallo().toString()));
        body.put("auto_return", "approved");
        if (properties.webhookPublicUrl() != null && !properties.webhookPublicUrl().toString().isBlank()) {
            body.put("notification_url", properties.webhookPublicUrl().toString());
        }
        Instant ahora = Instant.now();
        body.put("expires", true);
        body.put("expiration_date_from", FECHA.format(ahora));
        body.put("expiration_date_to", FECHA.format(preferencia.expiraAt()));
        body.put("date_of_expiration", FECHA.format(preferencia.expiraAt()));
        body.put("statement_descriptor", "CLOUDCOFFEE");
        body.put("metadata", Map.of("payment_id", preferencia.paymentId().toString(),
                "compra_id", preferencia.compraId().toString()));
        return body;
    }

    /** Lee id, external_reference y la URL de checkout del modo configurado; null si falta algo. */
    private Preferencia leerPreferencia(String body) {
        try {
            JsonNode nodo = json.readTree(body == null ? "" : body);
            String id = texto(nodo, "id");
            String referencia = texto(nodo, "external_reference");
            if (id == null || referencia == null) return null;
            String checkout = texto(nodo, properties.usesSandboxInitPoint() ? "sandbox_init_point" : "init_point");
            return new Preferencia(id, referencia, checkoutSeguro(checkout));
        } catch (JacksonException error) {
            return null;
        }
    }

    private static URI checkoutSeguro(String valor) {
        if (valor == null) return null;
        try {
            URI uri = URI.create(valor);
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null ? uri : null;
        } catch (IllegalArgumentException error) {
            return null;
        }
    }

    private static String texto(JsonNode nodo, String campo) {
        JsonNode valor = nodo.path(campo);
        if (valor.isString() && !valor.asString().isBlank()) return valor.asString();
        return null;
    }

    private static boolean conexionNoEstablecida(Throwable error) {
        for (Throwable causa = error; causa != null; causa = causa.getCause()) {
            if (causa instanceof ConnectException || causa instanceof UnknownHostException) return true;
        }
        return false;
    }
}
