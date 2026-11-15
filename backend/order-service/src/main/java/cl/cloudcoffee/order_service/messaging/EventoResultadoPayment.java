package cl.cloudcoffee.order_service.messaging;

import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

import cl.cloudcoffee.order_service.service.ResultadoExternoService.ResultadoExterno;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Lectura estricta de {@code payment.pago.resultado.v1} (docs/payment-service.eventos.json). */
public final class EventoResultadoPayment {

    static final Set<String> ESTADOS = Set.of("pendiente", "aprobado", "rechazado", "cancelado", "vencido",
            "requiere_conciliacion");
    private static final Pattern TRACE = Pattern.compile("[0-9a-f]{32}");
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private EventoResultadoPayment() {
    }

    /** @throws IllegalArgumentException si el mensaje no cumple el contrato. */
    public static ResultadoExterno leer(byte[] cuerpo) {
        JsonNode evento;
        try {
            evento = JSON.readTree(cuerpo);
        } catch (JacksonException error) {
            throw new IllegalArgumentException("El evento no es JSON válido");
        }
        if (evento == null || !evento.isObject()) throw new IllegalArgumentException("El evento debe ser un objeto");
        if (!PaymentResultadosTopology.PAYMENT_RESULT.equals(texto(evento, "eventType"))) {
            throw new IllegalArgumentException("eventType inesperado");
        }
        UUID eventId = uuid(evento, "eventId");
        String trace = texto(evento, "traceId");
        if (trace == null || !TRACE.matcher(trace).matches()) throw new IllegalArgumentException("traceId inválido");
        JsonNode p = evento.path("payload");
        if (!p.isObject()) throw new IllegalArgumentException("payload ausente");
        String estado = texto(p, "estado");
        if (estado == null || !ESTADOS.contains(estado)) throw new IllegalArgumentException("estado inválido");
        if (!"CLP".equals(texto(p, "moneda")) || !"mercadopago_sandbox".equals(texto(p, "proveedor"))
                || !"sandbox".equals(texto(p, "entorno"))) {
            throw new IllegalArgumentException("moneda, proveedor o entorno inesperados");
        }
        JsonNode monto = p.path("montoTotal");
        JsonNode version = p.path("version");
        if (!monto.isIntegralNumber() || monto.asLong() < 1 || monto.asLong() > 2_000_000_000L) {
            throw new IllegalArgumentException("montoTotal inválido");
        }
        if (!version.isIntegralNumber() || version.asLong() < 1) throw new IllegalArgumentException("version inválida");
        return new ResultadoExterno(eventId, uuid(p, "paymentId"), uuid(p, "compraId"), uuid(p, "clienteId"), estado,
                texto(p, "motivo"), monto.asLong(), version.asLong(), trace);
    }

    private static String texto(JsonNode nodo, String campo) {
        JsonNode valor = nodo.path(campo);
        return valor.isString() && !valor.asString().isBlank() ? valor.asString() : null;
    }

    private static UUID uuid(JsonNode nodo, String campo) {
        String valor = texto(nodo, campo);
        if (valor == null) throw new IllegalArgumentException(campo + " ausente");
        try {
            return UUID.fromString(valor);
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException(campo + " no es UUID");
        }
    }
}
