package cl.cloudcoffee.payment_service.pagos;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import cl.cloudcoffee.payment_service.mercadopago.ProveedorPagos.PagoProveedor;
import cl.cloudcoffee.payment_service.preferencias.IntencionRepository;
import cl.cloudcoffee.payment_service.preferencias.IntencionRepository.Intencion;
import cl.cloudcoffee.payment_service.preferencias.PreferenciaResponse;
import tools.jackson.databind.json.JsonMapper;

/**
 * Aplica el estado <em>actual</em> de un pago del proveedor a su intención (INT2-112).
 *
 * <p>Reglas (contrato Payment 2.0.0, "Estados y conciliación"):
 * <ul>
 * <li>Solo se acredita lo consultado al proveedor; la notificación o el retorno del navegador nunca bastan.</li>
 * <li>La referencia, el monto, la moneda y el entorno deben coincidir con la intención persistida. Una
 * discrepancia queda como evidencia y, si hubo o puede haber dinero comprometido, la intención pasa a
 * conciliación manual.</li>
 * <li>Los estados no retroceden: solo PENDING pasa a un resultado (aprobado, rechazado, cancelado, vencido);
 * desde un resultado solo se puede ir a REQUIRES_RECONCILIATION, que es final para la automatización.</li>
 * <li>La tardanza se decide con la fecha de aprobación del proveedor contra {@code expiraAt}, no con el orden de
 * llegada de las notificaciones.</li>
 * <li>Cada cambio de estado incrementa la versión y escribe, en la misma transacción, un evento
 * {@code payment.pago.resultado.v1} en el outbox con un eventId que no cambia en los reintentos.</li>
 * </ul>
 */
@Service
public class ConciliacionPagos {

    public enum Efecto {
        /** La intención cambió de estado y se escribió un evento. */
        APLICADO,
        /** Observación registrada sin cambio de estado (pendiente, repetida, vieja o estado ya final). */
        SIN_CAMBIOS,
        /** La intención todavía no tiene preferencia confirmada (INT2-111 en conciliación): reintentar después. */
        SIN_PREFERENCIA,
        /** El pago no pertenece a ninguna intención de Payment: evidencia sin efectos. */
        REFERENCIA_AJENA
    }

    static final String PENDING = "PENDING";
    static final String APPROVED = "APPROVED";
    static final String REJECTED = "REJECTED";
    static final String CANCELLED = "CANCELLED";
    static final String EXPIRED = "EXPIRED";
    static final String RECONCILIATION = "REQUIRES_RECONCILIATION";

    /** Estados del proveedor en los que el comprador pagó o aún puede terminar pagando. */
    private static final Set<String> DINERO_COMPROMETIDO = Set.of("approved", "authorized", "in_process", "pending",
            "in_mediation");
    private static final BigDecimal MAXIMO = BigDecimal.valueOf(2_000_000_000L);

    private static final Logger log = LoggerFactory.getLogger(ConciliacionPagos.class);

    private final IntencionRepository intenciones;
    private final PagosRepository repo;
    private final TransactionTemplate tx;
    private final Clock clock;
    private final JsonMapper json = JsonMapper.builder().build();

    public ConciliacionPagos(IntencionRepository intenciones, PagosRepository repo, PlatformTransactionManager manager,
            Clock clock) {
        this.intenciones = intenciones;
        this.repo = repo;
        this.tx = new TransactionTemplate(manager);
        this.clock = clock;
    }

    /**
     * Aplica el pago en una transacción propia. Si {@code inboxId} no es null, la notificación se marca procesada
     * en la misma transacción (salvo SIN_PREFERENCIA, que no escribe nada para poder reintentar).
     */
    public Efecto aplicar(PagoProveedor pago, String traceId, UUID inboxId) {
        return tx.execute(status -> {
            Instant ahora = clock.instant();
            var encontrada = pago.referenciaExterna() == null ? java.util.Optional.<Intencion>empty()
                    : intenciones.porReferencia(pago.referenciaExterna());
            if (encontrada.isEmpty()) {
                log.warn("Pago externo {} con referencia ajena a Payment: se guarda como evidencia sin efectos", pago.id());
                repo.anomalia(null, pago.id(), "referencia_ajena", pago.evidencia(), ahora);
                if (inboxId != null) repo.inboxProcesada(inboxId, "REFERENCIA_AJENA", ahora);
                return Efecto.REFERENCIA_AJENA;
            }
            UUID id = encontrada.get().id();
            repo.bloquearIntencion(id);
            Intencion intencion = intenciones.porId(id);
            if (intencion.preferenciaId() == null) return Efecto.SIN_PREFERENCIA;

            List<String> discrepancias = discrepancias(intencion, pago);
            if (discrepancias.isEmpty() && !repo.guardarPagoProveedor(id, pago, intencion.monto(), ahora)) {
                // Ya se había guardado una observación más nueva de este pago: esta consulta llegó atrasada.
                if (inboxId != null) repo.inboxProcesada(inboxId, "OBSERVACION_ANTIGUA", ahora);
                return Efecto.SIN_CAMBIOS;
            }
            for (String motivo : discrepancias) repo.anomalia(id, pago.id(), motivo, pago.evidencia(), ahora);

            Decision decision = decidir(intencion, pago, discrepancias, ahora);
            if (decision != null) {
                // Fecha efectiva del proveedor: la de aprobación para un pago aprobado, si no la de su último cambio.
                Instant ocurrido = "approved".equals(pago.estado()) ? fechaAprobacion(pago) : pago.actualizadoAt();
                transicionar(intencion, decision, pago.id(), ocurrido, traceId, ahora);
            }
            if (inboxId != null) repo.inboxProcesada(inboxId, null, ahora);
            return decision == null ? Efecto.SIN_CAMBIOS : Efecto.APLICADO;
        });
    }

    /**
     * Vencimiento local (política del contrato): una intención pendiente sin aprobación aplicada vence en
     * {@code expiraAt}. Una aprobación que aparezca después queda en conciliación, nunca se pierde.
     */
    public boolean vencer(UUID id, String traceId) {
        Boolean vencida = tx.execute(status -> {
            Instant ahora = clock.instant();
            repo.bloquearIntencion(id);
            Intencion intencion = intenciones.porId(id);
            if (!PENDING.equals(intencion.estado()) || intencion.preferenciaId() == null
                    || intencion.expiraAt().isAfter(ahora)) {
                return false;
            }
            transicionar(intencion, new Decision(EXPIRED, "reserva_vencida"), null, intencion.expiraAt(), traceId, ahora);
            return true;
        });
        return Boolean.TRUE.equals(vencida);
    }

    private record Decision(String estado, String motivo) {
    }

    private Decision decidir(Intencion intencion, PagoProveedor pago, List<String> discrepancias, Instant ahora) {
        String actual = intencion.estado();
        // Conciliación manual: la automatización ya no cambia el estado (sí sigue guardando evidencia).
        if (RECONCILIATION.equals(actual)) return null;
        String estado = pago.estado();
        if (!discrepancias.isEmpty()) {
            return DINERO_COMPROMETIDO.contains(estado) ? new Decision(RECONCILIATION, discrepancias.getFirst()) : null;
        }
        return switch (estado) {
            case "pending", "in_process", "authorized" -> null;
            case "in_mediation" -> new Decision(RECONCILIATION, "en_mediacion");
            case "approved" -> aprobacion(intencion, pago);
            case "rejected" -> PENDING.equals(actual) ? new Decision(REJECTED, "proveedor_rechazado") : null;
            case "cancelled" -> PENDING.equals(actual) ? new Decision(CANCELLED, "proveedor_cancelado") : null;
            case "refunded" -> new Decision(RECONCILIATION, "reembolsado");
            case "charged_back" -> new Decision(RECONCILIATION, "contracargo");
            default -> {
                log.warn("Pago externo {} con estado desconocido; se guarda como evidencia", pago.id());
                repo.anomalia(intencion.id(), pago.id(), "estado_desconocido", pago.evidencia(), ahora);
                yield null;
            }
        };
    }

    private Decision aprobacion(Intencion intencion, PagoProveedor pago) {
        boolean tardia = fechaAprobacion(pago).isAfter(intencion.expiraAt());
        return switch (intencion.estado()) {
            case PENDING -> tardia ? new Decision(RECONCILIATION, "aprobacion_tardia")
                    : new Decision(APPROVED, "proveedor_confirmado");
            // Dos aprobaciones de la misma preferencia: una anomalía conciliable, nunca dos cumplimientos.
            case APPROVED -> repo.otroPagoAprobado(intencion.id(), pago.id())
                    ? new Decision(RECONCILIATION, "doble_aprobacion") : null;
            // Order ya liberó las reservas: aunque la aprobación fuera en plazo, se resuelve manualmente.
            case EXPIRED -> new Decision(RECONCILIATION, tardia ? "aprobacion_tardia" : "aprobacion_tras_vencimiento");
            case REJECTED, CANCELLED -> new Decision(RECONCILIATION, "aprobacion_tras_cierre");
            default -> null;
        };
    }

    private static Instant fechaAprobacion(PagoProveedor pago) {
        return pago.aprobadoAt() != null ? pago.aprobadoAt() : pago.actualizadoAt();
    }

    /** Referencia ya coincide (se buscó por ella); se comparan monto, moneda y entorno de prueba. */
    private static List<String> discrepancias(Intencion intencion, PagoProveedor pago) {
        List<String> motivos = new ArrayList<>();
        if (!"CLP".equals(pago.moneda())) motivos.add("moneda_discrepante");
        // Un pago productivo (o sin live_mode informado) nunca acredita una intención sandbox.
        if (!Boolean.FALSE.equals(pago.liveMode())) motivos.add("entorno_discrepante");
        BigDecimal monto = pago.monto();
        if (monto == null || monto.signum() <= 0 || monto.compareTo(MAXIMO) > 0
                || monto.compareTo(BigDecimal.valueOf(intencion.monto())) != 0) {
            motivos.add("monto_discrepante");
        }
        return motivos;
    }

    private void transicionar(Intencion intencion, Decision decision, String pagoId, Instant ocurrido, String traceId,
            Instant ahora) {
        if (!repo.transicionar(intencion.id(), intencion.version(), intencion.estado(), decision.estado(),
                decision.motivo(), ahora)) {
            // La fila está bloqueada en esta transacción: si no avanzó, el estado leído ya no es válido.
            throw new IllegalStateException("La intención cambió durante la conciliación");
        }
        long version = intencion.version() + 1;
        UUID eventId = UUID.randomUUID();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("paymentId", intencion.id().toString());
        payload.put("compraId", intencion.compraId().toString());
        payload.put("clienteId", intencion.clienteId().toString());
        payload.put("preferenciaId", intencion.preferenciaId());
        payload.put("proveedorPagoId", pagoId);
        payload.put("estado", PreferenciaResponse.estado(decision.estado()));
        payload.put("motivo", decision.motivo());
        payload.put("montoTotal", intencion.monto());
        payload.put("moneda", "CLP");
        payload.put("proveedor", "mercadopago_sandbox");
        payload.put("entorno", "sandbox");
        payload.put("version", version);
        payload.put("ocurridoAt", ocurrido.toString());
        payload.put("expiraAt", intencion.expiraAt().toString());
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("eventId", eventId.toString());
        envelope.put("eventType", "payment.pago.resultado.v1");
        envelope.put("timestamp", ahora.toString());
        envelope.put("traceId", traceId);
        envelope.put("payload", payload);
        repo.insertarOutbox(eventId, intencion.id(), version, json.writeValueAsString(envelope), traceId, ocurrido, ahora);
        log.info("Intención {} pasó de {} a {} ({}), versión {}", intencion.id(), intencion.estado(), decision.estado(),
                decision.motivo(), version);
    }
}
