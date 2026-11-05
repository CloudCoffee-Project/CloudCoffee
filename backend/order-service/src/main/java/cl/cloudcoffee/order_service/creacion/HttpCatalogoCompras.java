package cl.cloudcoffee.order_service.creacion;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.HttpClientErrorException;
import cl.cloudcoffee.security.InternalServiceAuthenticationFilter;
import tools.jackson.databind.json.JsonMapper;

@Component
public class HttpCatalogoCompras implements CatalogoCompras {
    private final RestClient http;
    private final String token;
    private final JsonMapper json;
    public HttpCatalogoCompras(@Value("${cloudcoffee.catalog.url:${CATALOG_SERVICE_URL:http://localhost:18082}}") String url,
            @Value("${cloudcoffee.internal.token:${INTERNAL_SERVICE_TOKEN:}}") String token,
            @Value("${cloudcoffee.catalog.timeout:PT2S}") Duration timeout, JsonMapper json) {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(timeout);
        factory.setReadTimeout(timeout);
        http = RestClient.builder().baseUrl(url).requestFactory(factory).build();
        this.token = token;
        this.json = json;
    }
    public List<Oferta> cotizar(List<UUID> ofertas) {
        Oferta[] respuesta = post("/internal/servicios/catalogo/cotizaciones", ofertas, Oferta[].class);
        if (respuesta == null) throw new NoDisponible();
        return Arrays.asList(respuesta);
    }
    public Reserva reservar(UUID orden, UUID oferta, int cantidad, UUID intento, Instant vence, BigDecimal precio) {
        Reserva reserva = post("/internal/servicios/catalogo/reservas", Map.of("orderId", orden,
                "offerId", oferta, "quantity", cantidad, "attemptId", intento,
                "expiresAt", vence, "expectedPrice", precio), Reserva.class);
        if (reserva == null || reserva.reservationId() == null || !orden.equals(reserva.orderId())
                || !oferta.equals(reserva.offerId()) || !intento.equals(reserva.attemptId())
                || cantidad != reserva.quantity() || reserva.expiresAt() == null || !vence.equals(reserva.expiresAt())
                || reserva.status() == null || !Set.of("RESERVED", "EXPIRED", "RELEASED").contains(reserva.status())) throw new NoDisponible();
        return reserva;
    }
    public void liberar(UUID reserva) {
        Reserva respuesta;
        try { respuesta = post("/internal/servicios/catalogo/reservas/" + reserva + "/liberar", null, Reserva.class); }
        catch (Rechazo resultadoInesperado) { throw new NoDisponible(); }
        if (respuesta == null || !reserva.equals(respuesta.reservationId())
                || respuesta.status() == null || !Set.of("RELEASED", "EXPIRED").contains(respuesta.status())) throw new NoDisponible();
    }
    private <T> T post(String ruta, Object body, Class<T> tipo) {
        if (token == null || token.length() < 32) throw new NoDisponible();
        try {
            var request = http.post().uri(ruta).header(InternalServiceAuthenticationFilter.HEADER, token)
                    .contentType(org.springframework.http.MediaType.APPLICATION_JSON);
            if (body != null) request.body(body);
            return request.retrieve().body(tipo);
        } catch (HttpClientErrorException error) {
            // Un 401/403/404 de infraestructura jamás se interpreta como falta de stock.
            if (error.getStatusCode().value() == 409) {
                try {
                    String code = json.readTree(error.getResponseBodyAsString()).path("code").asString();
                    if (code != null && Set.of("STOCK_NO_DISPONIBLE", "OFERTA_NO_DISPONIBLE", "RESERVA_VENCIDA").contains(code)) {
                        throw new Rechazo(code);
                    }
                } catch (tools.jackson.core.JacksonException ignored) { /* respuesta no confiable */ }
            }
            throw new NoDisponible();
        } catch (RestClientException | IllegalArgumentException error) { throw new NoDisponible(); }
    }
}
