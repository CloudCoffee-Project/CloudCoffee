package cl.cloudcoffee.payment_service.pagos;

import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.payment_service.config.PaymentProperties;
import cl.cloudcoffee.payment_service.pagos.FirmaWebhook.Invalida;
import cl.cloudcoffee.payment_service.preferencias.PagoNoDisponibleException;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Recepción del webhook de Mercado Pago (INT2-112). Orden de validación:
 * <ol>
 * <li>Sin proveedor o sin secreto configurado: 503 PAYMENT_NOT_ENABLED, sin leer ni guardar nada.</li>
 * <li>{@code data.id}/{@code type} de la URL ausentes o mal formados: 400 (son parte de la firma).</li>
 * <li>Firma, request-id o timestamp inválidos: 401 FIRMA_INVALIDA, sin guardar nada.</li>
 * <li>Cuerpo que no cumple el contrato o no coincide con la URL firmada: 400.</li>
 * <li>Se guarda en el inbox (202). Una notificación ya guardada responde 200 sin repetir efectos.</li>
 * </ol>
 * La firma solo prueba el origen: el estado del pago se lee después del proveedor. Nunca se guardan la firma,
 * tokens ni datos de tarjeta; solo metadatos saneados de la notificación.
 */
@Service
public class RecepcionWebhook {

    public enum Recepcion { NUEVA, DUPLICADA }

    static final int MAXIMO_CUERPO = 16 * 1024;
    private static final Pattern IDENTIFICADOR = Pattern.compile("[A-Za-z0-9_-]{1,128}");
    private static final URI INVALIDA = URI.create("https://cloudcoffee.cl/problemas/notificacion-invalida");
    private static final URI FIRMA = URI.create("https://cloudcoffee.cl/problemas/firma-invalida");
    private static final Logger log = LoggerFactory.getLogger(RecepcionWebhook.class);

    private final PaymentProperties properties;
    private final PagosRepository repo;
    private final Clock clock;
    private final JsonMapper json = JsonMapper.builder().build();

    public RecepcionWebhook(PaymentProperties properties, PagosRepository repo, Clock clock) {
        this.properties = properties;
        this.repo = repo;
        this.clock = clock;
    }

    public Recepcion recibir(String dataId, String tipo, String firma, String requestId, String cuerpo) {
        if (!properties.webhookEnabled()) {
            throw new PagoNoDisponibleException("PAYMENT_NOT_ENABLED",
                    "La recepción de pagos externos no está habilitada.", 2);
        }
        if (dataId == null || !IDENTIFICADOR.matcher(dataId).matches()) throw invalida("data.id ausente o inválido.");
        if (!"payment".equals(tipo)) throw invalida("Solo se aceptan notificaciones de tipo payment.");
        Instant ahora = clock.instant();
        var verificacion = FirmaWebhook.verificar(properties.webhookSecret(), firma, requestId, dataId, ahora,
                properties.signatureTolerance());
        if (verificacion instanceof Invalida invalida) {
            // El motivo no incluye valores recibidos ni el secreto.
            log.warn("Notificación de Mercado Pago rechazada: {}", invalida.motivo());
            throw new BusinessException(HttpStatus.UNAUTHORIZED, FIRMA, "Firma inválida",
                    "La notificación no tiene una firma válida del proveedor.", "FIRMA_INVALIDA");
        }
        Notificacion notificacion = leer(cuerpo, dataId);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("notificationId", notificacion.id());
        payload.put("type", "payment");
        payload.put("action", notificacion.accion());
        payload.put("dataId", dataId);
        payload.put("liveMode", notificacion.liveMode());
        payload.put("dateCreated", notificacion.creada());
        payload.put("requestId", requestId);
        payload.put("receivedAt", ahora.toString());
        try {
            repo.insertarInbox(UUID.randomUUID(), notificacion.id(), dataId, json.writeValueAsString(payload),
                    Trazas.actual(), ahora);
            return Recepcion.NUEVA;
        } catch (DuplicateKeyException repetida) {
            return Recepcion.DUPLICADA;
        } catch (DataAccessException error) {
            log.warn("No se pudo persistir la notificación {}: {}", notificacion.id(), error.getClass().getSimpleName());
            throw new PagoNoDisponibleException("RECEPCION_NO_DISPONIBLE",
                    "No se pudo registrar la notificación. Reintenta más tarde.", 2);
        }
    }

    private record Notificacion(String id, String accion, Boolean liveMode, String creada) {
    }

    private Notificacion leer(String cuerpo, String dataId) {
        if (cuerpo == null || cuerpo.isBlank() || cuerpo.length() > MAXIMO_CUERPO) {
            throw invalida("Cuerpo ausente o demasiado grande.");
        }
        JsonNode nodo;
        try {
            nodo = json.readTree(cuerpo);
        } catch (JacksonException error) {
            throw invalida("El cuerpo no es JSON válido.");
        }
        if (!nodo.isObject()) throw invalida("El cuerpo debe ser un objeto JSON.");
        JsonNode id = nodo.path("id");
        String notificacionId = id.isIntegralNumber() ? id.asString() : id.isString() ? id.asString() : null;
        if (notificacionId == null || !IDENTIFICADOR.matcher(notificacionId).matches()) {
            throw invalida("id de notificación ausente o inválido.");
        }
        if (!"payment".equals(texto(nodo.path("type")))) throw invalida("type debe ser payment.");
        JsonNode dato = nodo.path("data").path("id");
        String cuerpoDataId = dato.isIntegralNumber() ? dato.asString() : texto(dato);
        // Lo firmado es data.id de la URL: el cuerpo debe referirse al mismo pago.
        if (!dataId.equals(cuerpoDataId)) throw invalida("data.id del cuerpo no coincide con la URL.");
        String accion = texto(nodo.path("action"));
        if (accion != null && accion.length() > 64) accion = accion.substring(0, 64);
        String creada = texto(nodo.path("date_created"));
        if (creada != null && creada.length() > 64) creada = null;
        JsonNode live = nodo.path("live_mode");
        return new Notificacion(notificacionId, accion, live.isBoolean() ? live.asBoolean() : null, creada);
    }

    private static String texto(JsonNode nodo) {
        return nodo.isString() ? nodo.asString() : null;
    }

    private static BusinessException invalida(String detalle) {
        return new BusinessException(HttpStatus.BAD_REQUEST, INVALIDA, "Notificación inválida", detalle,
                "NOTIFICACION_INVALIDA");
    }
}
