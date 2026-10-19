package cl.cloudcoffee.security;

import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * Consulta la asignación en auth-service ({@code GET /internal/servicios/asignaciones/{usuarioId}})
 * autenticándose con el token interno entre servicios. No guarda caché: un cambio de
 * asignación rige en la siguiente solicitud.
 */
public class HttpAsignacionesCafeteria implements AsignacionesCafeteria {

    static final String RUTA = "/internal/servicios/asignaciones/{usuarioId}";

    private final RestClient restClient;
    private final String token;

    public HttpAsignacionesCafeteria(String authServiceUrl, String token, Duration timeout) {
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(timeout);
        requestFactory.setReadTimeout(timeout);
        this.restClient = RestClient.builder().baseUrl(authServiceUrl).requestFactory(requestFactory).build();
        this.token = token;
    }

    @Override
    public Optional<UUID> cafeteriaDe(UUID usuarioId) {
        if (token == null || token.isBlank()) {
            throw new AsignacionNoVerificableException("Falta configurar cloudcoffee.internal.token", null);
        }
        try {
            Map<?, ?> respuesta = restClient.get()
                    .uri(RUTA, usuarioId)
                    .header(InternalServiceAuthenticationFilter.HEADER, token)
                    .retrieve()
                    .body(Map.class);
            Object cafeteria = respuesta == null ? null : respuesta.get("cafeteriaId");
            if (cafeteria == null) {
                throw new AsignacionNoVerificableException("Respuesta de auth-service sin cafeteriaId", null);
            }
            return Optional.of(UUID.fromString(cafeteria.toString()));
        } catch (HttpClientErrorException exception) {
            if (exception.getStatusCode().isSameCodeAs(HttpStatus.NOT_FOUND)) {
                return Optional.empty();
            }
            throw new AsignacionNoVerificableException("auth-service rechazó la consulta: " + exception.getStatusCode(), exception);
        } catch (RestClientException | IllegalArgumentException exception) {
            throw new AsignacionNoVerificableException("No se pudo consultar la asignación en auth-service", exception);
        }
    }
}
