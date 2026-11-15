package cl.cloudcoffee.payment_service.mercadopago;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import cl.cloudcoffee.payment_service.config.PaymentProperties;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Adaptador HTTP de pagos de Mercado Pago: {@code GET /v1/payments/{id}} y
 * {@code GET /v1/payments/search?external_reference=}. Solo extrae los campos necesarios para conciliar;
 * nunca guarda datos del pagador ni de la tarjeta. El access token solo viaja en Authorization.
 */
@Component
public class MercadoPagoPagos implements ProveedorPagos {

    /** Una intención legítima tiene pocos intentos de pago; más que esto exige revisión operativa. */
    static final int LIMITE_BUSQUEDA = 100;

    private final RestClient http;
    private final PaymentProperties properties;
    private final JsonMapper json = JsonMapper.builder().build();

    @Autowired
    public MercadoPagoPagos(PaymentProperties properties) {
        this(properties, RestClient.builder().requestFactory(MercadoPagoPreferencias.factory(properties)));
    }

    MercadoPagoPagos(PaymentProperties properties, RestClient.Builder builder) {
        this.properties = properties;
        this.http = builder.baseUrl(properties.mercadopagoApiUrl().toString()).build();
    }

    @Override
    public Consulta consultar(String pagoId) {
        try {
            String body = http.get().uri("/v1/payments/{id}", pagoId)
                    .header("Authorization", "Bearer " + properties.accessToken())
                    .accept(MediaType.APPLICATION_JSON)
                    .retrieve().body(String.class);
            PagoProveedor pago = leer(json.readTree(body == null ? "" : body));
            if (pago == null || !pagoId.equals(pago.id())) return new Fallida("pago no verificable");
            return new Encontrado(pago);
        } catch (HttpClientErrorException.NotFound noExiste) {
            return new NoEncontrado();
        } catch (RestClientException | JacksonException error) {
            return new Fallida(error.getClass().getSimpleName());
        }
    }

    @Override
    public Busqueda buscarPorReferencia(String referenciaExterna) {
        try {
            String body = http.get()
                    .uri(uri -> uri.path("/v1/payments/search")
                            .queryParam("external_reference", referenciaExterna)
                            .queryParam("sort", "date_created").queryParam("criteria", "asc")
                            .queryParam("limit", LIMITE_BUSQUEDA).build())
                    .header("Authorization", "Bearer " + properties.accessToken())
                    .accept(MediaType.APPLICATION_JSON)
                    .retrieve().body(String.class);
            JsonNode raiz = json.readTree(body == null ? "" : body);
            JsonNode resultados = raiz.path("results");
            if (!resultados.isArray()) return new Fallida("búsqueda sin results");
            if (raiz.path("paging").path("total").asLong(0) > resultados.size()) {
                return new Fallida("búsqueda incompleta");
            }
            List<PagoProveedor> pagos = new ArrayList<>();
            for (JsonNode resultado : resultados) {
                PagoProveedor pago = leer(resultado);
                if (pago == null) return new Fallida("pago no verificable en la búsqueda");
                // El filtro lo aplica el proveedor; igual se descarta lo que no sea de esta referencia.
                if (referenciaExterna.equals(pago.referenciaExterna())) pagos.add(pago);
            }
            return new Pagos(List.copyOf(pagos));
        } catch (RestClientException | JacksonException error) {
            return new Fallida(error.getClass().getSimpleName());
        }
    }

    /** null si falta un campo imprescindible (id, estado, monto, moneda o fecha de actualización). */
    PagoProveedor leer(JsonNode nodo) {
        String id = identificador(nodo.path("id"));
        String estado = texto(nodo, "status");
        JsonNode monto = nodo.path("transaction_amount");
        String moneda = texto(nodo, "currency_id");
        Instant actualizado = fecha(nodo, "date_last_updated");
        if (actualizado == null) actualizado = fecha(nodo, "date_created");
        if (id == null || estado == null || !monto.isNumber() || moneda == null || actualizado == null) return null;
        JsonNode live = nodo.path("live_mode");
        Boolean liveMode = live.isBoolean() ? live.asBoolean() : null;
        Map<String, Object> evidencia = new LinkedHashMap<>();
        evidencia.put("id", id);
        evidencia.put("status", estado);
        evidencia.put("status_detail", texto(nodo, "status_detail"));
        evidencia.put("external_reference", texto(nodo, "external_reference"));
        evidencia.put("transaction_amount", monto.decimalValue());
        evidencia.put("currency_id", moneda);
        evidencia.put("live_mode", liveMode);
        evidencia.put("date_approved", texto(nodo, "date_approved"));
        evidencia.put("date_last_updated", texto(nodo, "date_last_updated"));
        return new PagoProveedor(id, estado, texto(nodo, "status_detail"), texto(nodo, "external_reference"),
                monto.decimalValue(), moneda, liveMode, fecha(nodo, "date_approved"), actualizado,
                json.writeValueAsString(evidencia));
    }

    private static String identificador(JsonNode valor) {
        if (valor.isIntegralNumber()) return valor.asString();
        if (valor.isString() && !valor.asString().isBlank()) return valor.asString();
        return null;
    }

    private static String texto(JsonNode nodo, String campo) {
        JsonNode valor = nodo.path(campo);
        return valor.isString() && !valor.asString().isBlank() ? valor.asString() : null;
    }

    private static Instant fecha(JsonNode nodo, String campo) {
        String valor = texto(nodo, campo);
        if (valor == null) return null;
        try {
            return OffsetDateTime.parse(valor).toInstant();
        } catch (DateTimeParseException error) {
            return null;
        }
    }
}
