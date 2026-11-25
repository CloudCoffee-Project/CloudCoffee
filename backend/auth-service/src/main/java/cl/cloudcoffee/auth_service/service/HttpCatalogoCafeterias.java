package cl.cloudcoffee.auth_service.service;

import java.time.Duration;
import java.util.Optional;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import cl.cloudcoffee.security.InternalServiceAuthenticationFilter;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Cliente de la ruta interna de Catalog; falla cerrado ante cualquier respuesta no verificable. */
@Component
public class HttpCatalogoCafeterias implements CatalogoCafeterias {

    static final String RUTA = "/internal/servicios/catalogo/cafeterias/{cafeteriaId}";

    private final RestClient http;
    private final String token;
    private final JsonMapper json = JsonMapper.builder().build();

    @Autowired
    public HttpCatalogoCafeterias(
            @Value("${cloudcoffee.catalog.url:${CATALOG_SERVICE_URL:http://localhost:18082}}") String url,
            @Value("${cloudcoffee.internal.token:${INTERNAL_SERVICE_TOKEN:}}") String token,
            @Value("${cloudcoffee.catalog.timeout:PT2S}") Duration timeout) {
        this(RestClient.builder().baseUrl(url).requestFactory(factory(timeout)), token);
    }

    HttpCatalogoCafeterias(RestClient.Builder builder, String token) {
        this.http = builder.build();
        this.token = token;
    }

    private static SimpleClientHttpRequestFactory factory(Duration timeout) {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(timeout);
        factory.setReadTimeout(timeout);
        return factory;
    }

    @Override
    public Optional<Cafeteria> consultar(UUID cafeteriaId) {
        if (token == null || token.length() < 32) throw noDisponible();
        String body;
        try {
            body = http.get().uri(RUTA, cafeteriaId)
                    .header(InternalServiceAuthenticationFilter.HEADER, token)
                    .accept(MediaType.APPLICATION_JSON)
                    .retrieve().body(String.class);
        } catch (HttpClientErrorException.NotFound noExiste) {
            return Optional.empty();
        } catch (RestClientException error) {
            // 401/403/5xx o red: no se puede decidir, nunca se interpreta como "no existe".
            throw noDisponible();
        }
        try {
            JsonNode nodo = json.readTree(body == null ? "" : body);
            JsonNode id = nodo.path("cafeteriaId");
            JsonNode activa = nodo.path("activa");
            if (!id.isString() || !cafeteriaId.toString().equalsIgnoreCase(id.asString()) || !activa.isBoolean()) {
                throw noDisponible();
            }
            return Optional.of(new Cafeteria(cafeteriaId, activa.asBoolean()));
        } catch (JacksonException error) {
            throw noDisponible();
        }
    }

    private static OperacionPendienteException noDisponible() {
        return new OperacionPendienteException("No fue posible validar la cafetería con Catalog. Reintenta en unos segundos.");
    }
}
