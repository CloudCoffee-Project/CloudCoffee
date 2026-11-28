package cl.cloudcoffee.auth_service.service;

import java.time.Duration;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import cl.cloudcoffee.security.InternalServiceAuthenticationFilter;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Cliente de la ruta interna de Order; falla cerrado: sin respuesta verificable no hay baja. */
@Component
public class HttpComprasEnCurso implements ComprasEnCurso {

    static final String RUTA = "/internal/servicios/compras/usuarios/{usuarioId}/en-curso";

    private final RestClient http;
    private final String token;
    private final JsonMapper json = JsonMapper.builder().build();

    @Autowired
    public HttpComprasEnCurso(
            @Value("${cloudcoffee.order.url:${ORDER_SERVICE_URL:http://localhost:18083}}") String url,
            @Value("${cloudcoffee.internal.token:${INTERNAL_SERVICE_TOKEN:}}") String token,
            @Value("${cloudcoffee.order.timeout:PT2S}") Duration timeout) {
        this(RestClient.builder().baseUrl(url).requestFactory(factory(timeout)), token);
    }

    HttpComprasEnCurso(RestClient.Builder builder, String token) {
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
    public long contar(UUID usuarioId) {
        if (token == null || token.length() < 32) throw noDisponible();
        String body;
        try {
            body = http.get().uri(RUTA, usuarioId)
                    .header(InternalServiceAuthenticationFilter.HEADER, token)
                    .accept(MediaType.APPLICATION_JSON)
                    .retrieve().body(String.class);
        } catch (RestClientException error) {
            // Cualquier error (incluido un 404 de infraestructura) impide decidir: nunca se asume "sin compras".
            throw noDisponible();
        }
        try {
            JsonNode nodo = json.readTree(body == null ? "" : body);
            JsonNode id = nodo.path("usuarioId");
            JsonNode enCurso = nodo.path("enCurso");
            JsonNode compras = nodo.path("compras");
            if (!id.isString() || !usuarioId.toString().equalsIgnoreCase(id.asString()) || !enCurso.isBoolean()
                    || !compras.isIntegralNumber() || compras.asLong() < 0
                    || enCurso.asBoolean() != (compras.asLong() > 0)) {
                throw noDisponible();
            }
            return compras.asLong();
        } catch (JacksonException error) {
            throw noDisponible();
        }
    }

    private static OperacionPendienteException noDisponible() {
        return new OperacionPendienteException("No fue posible verificar tus compras en curso. Reintenta en unos segundos.");
    }
}
