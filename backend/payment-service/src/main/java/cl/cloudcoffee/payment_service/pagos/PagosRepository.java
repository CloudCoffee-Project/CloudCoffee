package cl.cloudcoffee.payment_service.pagos;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import cl.cloudcoffee.payment_service.mercadopago.ProveedorPagos.PagoProveedor;

/**
 * SQL de INT2-112 sobre las tablas de V1/V2: inbox de notificaciones, pagos del proveedor, anomalías, outbox y
 * transiciones de la intención. Cada reclamo o transición es un UPDATE condicionado: si dos trabajadores compiten
 * por la misma fila, solo uno avanza.
 */
@Repository
public class PagosRepository {

    private final JdbcTemplate jdbc;

    public PagosRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ---------------------------------------------------------------- inbox

    /** Inserta una notificación autenticada. Lanza DuplicateKeyException si (proveedor, notificación) ya existe. */
    public void insertarInbox(UUID id, String notificacionId, String pagoId, String payload, String traceId, Instant ahora) {
        jdbc.update("""
                INSERT INTO payment_inbox (id, provider, notification_id, provider_payment_id, payload, trace_id, status,
                    attempts, next_attempt_at, created_at, updated_at)
                VALUES (?, 'mercadopago_sandbox', ?, ?, ?, ?, 'RECEIVED', 0, ?, ?, ?)
                """, id, notificacionId, pagoId, payload, traceId, utc(ahora), utc(ahora), utc(ahora));
    }

    public record EntradaInbox(UUID id, String pagoId, String traceId, int intentos) {
    }

    public List<EntradaInbox> inboxPendientes(Instant ahora, int limite) {
        return jdbc.query("""
                SELECT id, provider_payment_id, trace_id, attempts FROM payment_inbox
                WHERE status = 'RECEIVED' AND next_attempt_at <= ?
                ORDER BY next_attempt_at, created_at LIMIT ?
                """, (rs, n) -> new EntradaInbox(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3),
                rs.getInt(4)), utc(ahora), limite);
    }

    /** Reserva la entrada durante {@code hasta} y cuenta el intento; false si otro trabajador la tomó. */
    public boolean reclamarInbox(UUID id, int intentosLeidos, Instant ahora, Instant hasta) {
        return jdbc.update("""
                UPDATE payment_inbox SET attempts = attempts + 1, next_attempt_at = ?, updated_at = ?
                WHERE id = ? AND status = 'RECEIVED' AND attempts = ? AND next_attempt_at <= ?
                """, utc(hasta), utc(ahora), id, intentosLeidos, utc(ahora)) == 1;
    }

    public void inboxProcesada(UUID id, String codigo, Instant ahora) {
        jdbc.update("""
                UPDATE payment_inbox SET status = 'PROCESSED', processed_at = ?, last_error_code = ?, updated_at = ?
                WHERE id = ? AND status = 'RECEIVED'
                """, utc(ahora), codigo, utc(ahora), id);
    }

    public void inboxReprogramar(UUID id, String codigo, Instant proxima, Instant ahora) {
        jdbc.update("""
                UPDATE payment_inbox SET next_attempt_at = ?, last_error_code = ?, updated_at = ?
                WHERE id = ? AND status = 'RECEIVED'
                """, utc(proxima), codigo, utc(ahora), id);
    }

    /** Agotó los intentos: queda como evidencia (DEAD) para revisión operativa; nunca se borra. */
    public void inboxMuerta(UUID id, String codigo, Instant ahora) {
        jdbc.update("""
                UPDATE payment_inbox SET status = 'DEAD', last_error_code = ?, updated_at = ?
                WHERE id = ? AND status = 'RECEIVED'
                """, codigo, utc(ahora), id);
    }

    // ---------------------------------------------------------------- intención

    /** Bloquea la fila de la intención hasta el fin de la transacción (serializa a quienes aplican pagos). */
    public void bloquearIntencion(UUID id) {
        jdbc.queryForList("SELECT id FROM payment_intent WHERE id = ? FOR UPDATE", id);
    }

    public boolean transicionar(UUID id, long version, String estadoActual, String estadoNuevo, String motivo, Instant ahora) {
        return jdbc.update("""
                UPDATE payment_intent SET status = ?, status_reason = ?, version = version + 1, updated_at = ?
                WHERE id = ? AND version = ? AND status = ?
                """, estadoNuevo, motivo, utc(ahora), id, version, estadoActual) == 1;
    }

    public record Candidata(UUID id, Instant consultadaAt) {
    }

    /**
     * Intenciones con preferencia a consultar al proveedor: pendientes sin consulta reciente (o ya vencidas y sin
     * consulta posterior al vencimiento) y, dentro de la ventana de aprobaciones tardías, las ya cerradas.
     */
    public List<Candidata> candidatasConciliacion(Instant ahora, Instant consultadaAntesDe, Instant venceDespuesDe,
            int limite) {
        return jdbc.query("""
                SELECT i.id, i.provider_checked_at FROM payment_intent i
                JOIN payment_preference p ON p.payment_intent_id = i.id
                WHERE (i.status = 'PENDING'
                       OR (i.status IN ('APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED') AND i.expires_at > ?))
                  AND (i.provider_checked_at IS NULL OR i.provider_checked_at <= ?
                       OR (i.status = 'PENDING' AND i.expires_at <= ? AND i.provider_checked_at < i.expires_at))
                ORDER BY COALESCE(i.provider_checked_at, i.created_at), i.id LIMIT ?
                """, (rs, n) -> new Candidata(rs.getObject(1, UUID.class), instante(rs.getObject(2, OffsetDateTime.class))),
                utc(venceDespuesDe), utc(consultadaAntesDe), utc(ahora), limite);
    }

    /** Reclama la consulta periódica de una intención (control optimista sobre provider_checked_at). */
    public boolean marcarConsultada(UUID id, Instant consultadaAt, Instant ahora) {
        if (consultadaAt == null) {
            return jdbc.update("UPDATE payment_intent SET provider_checked_at = ? WHERE id = ? AND provider_checked_at IS NULL",
                    utc(ahora), id) == 1;
        }
        return jdbc.update("UPDATE payment_intent SET provider_checked_at = ? WHERE id = ? AND provider_checked_at = ?",
                utc(ahora), id, utc(consultadaAt)) == 1;
    }

    // ---------------------------------------------------------------- pagos del proveedor

    /**
     * Inserta o actualiza la observación del pago externo. Devuelve false si lo guardado es más nuevo que lo
     * consultado (respuesta vieja): así una consulta atrasada nunca hace retroceder la observación.
     */
    public boolean guardarPagoProveedor(UUID intencionId, PagoProveedor pago, long monto, Instant ahora) {
        int filas = jdbc.update("""
                UPDATE provider_payment SET provider_status = ?, provider_status_detail = ?, provider_updated_at = ?,
                    version = version + 1, updated_at = ?
                WHERE provider_payment_id = ? AND payment_intent_id = ? AND provider_updated_at <= ?
                """, pago.estado(), recortar(pago.detalle(), 128), utc(pago.actualizadoAt()), utc(ahora), pago.id(),
                intencionId, utc(pago.actualizadoAt()));
        if (filas == 1) return true;
        Integer existentes = jdbc.queryForObject("SELECT COUNT(*) FROM provider_payment WHERE provider_payment_id = ?",
                Integer.class, pago.id());
        if (existentes != null && existentes > 0) return false;
        try {
            jdbc.update("""
                    INSERT INTO provider_payment (id, payment_intent_id, provider_payment_id, provider_status,
                        provider_status_detail, amount, currency, live_mode, provider_updated_at, created_at, updated_at, version)
                    VALUES (?, ?, ?, ?, ?, ?, 'CLP', FALSE, ?, ?, ?, 0)
                    """, UUID.randomUUID(), intencionId, pago.id(), pago.estado(), recortar(pago.detalle(), 128),
                    BigDecimal.valueOf(monto), utc(pago.actualizadoAt()), utc(ahora), utc(ahora));
            return true;
        } catch (DuplicateKeyException carrera) {
            return false;
        }
    }

    /** ¿Hay otro pago aprobado (distinto de {@code pagoId}) para la misma intención? */
    public boolean otroPagoAprobado(UUID intencionId, String pagoId) {
        Integer total = jdbc.queryForObject("""
                SELECT COUNT(*) FROM provider_payment
                WHERE payment_intent_id = ? AND provider_status = 'approved' AND provider_payment_id <> ?
                """, Integer.class, intencionId, pagoId);
        return total != null && total > 0;
    }

    /** Evidencia de una discrepancia. Idempotente por (pago externo, motivo). */
    public void anomalia(UUID intencionId, String pagoId, String motivo, String evidencia, Instant ahora) {
        Integer existentes = jdbc.queryForObject(
                "SELECT COUNT(*) FROM payment_anomaly WHERE provider_payment_id = ? AND reason = ?",
                Integer.class, pagoId, motivo);
        if (existentes != null && existentes > 0) return;
        try {
            jdbc.update("""
                    INSERT INTO payment_anomaly (id, payment_intent_id, provider_payment_id, reason, evidence, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """, UUID.randomUUID(), intencionId, pagoId, motivo, evidencia, utc(ahora));
        } catch (DuplicateKeyException carrera) {
            // Otro trabajador registró la misma evidencia.
        }
    }

    // ---------------------------------------------------------------- outbox

    public void insertarOutbox(UUID eventId, UUID intencionId, long version, String envelope, String traceId,
            Instant ocurrido, Instant ahora) {
        jdbc.update("""
                INSERT INTO payment_outbox (event_id, payment_intent_id, aggregate_version, event_type, exchange_name,
                    routing_key, payload, trace_id, occurred_at, status, attempts, next_attempt_at, created_at, updated_at)
                VALUES (?, ?, ?, 'payment.pago.resultado.v1', 'cloudcoffee.events', 'payment.pago.resultado.v1', ?, ?, ?,
                    'PENDING', 0, ?, ?, ?)
                """, eventId, intencionId, version, envelope, traceId, utc(ocurrido), utc(ahora), utc(ahora), utc(ahora));
    }

    public record EventoPendiente(UUID eventId, String exchange, String routingKey, String payload, int intentos) {
    }

    /**
     * Eventos listos para publicar. Por intención se publica en orden de versión: una versión no sale mientras
     * otra anterior de la misma intención siga pendiente.
     */
    public List<EventoPendiente> outboxPendientes(Instant ahora, int limite) {
        return jdbc.query("""
                SELECT o.event_id, o.exchange_name, o.routing_key, o.payload, o.attempts FROM payment_outbox o
                WHERE o.status = 'PENDING' AND o.next_attempt_at <= ?
                  AND NOT EXISTS (SELECT 1 FROM payment_outbox a WHERE a.payment_intent_id = o.payment_intent_id
                                  AND a.status = 'PENDING' AND a.aggregate_version < o.aggregate_version)
                ORDER BY o.occurred_at, o.aggregate_version LIMIT ?
                """, (rs, n) -> new EventoPendiente(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3),
                rs.getString(4), rs.getInt(5)), utc(ahora), limite);
    }

    public boolean reclamarOutbox(UUID eventId, int intentosLeidos, Instant ahora, Instant hasta) {
        return jdbc.update("""
                UPDATE payment_outbox SET attempts = attempts + 1, next_attempt_at = ?, updated_at = ?
                WHERE event_id = ? AND status = 'PENDING' AND attempts = ? AND next_attempt_at <= ?
                """, utc(hasta), utc(ahora), eventId, intentosLeidos, utc(ahora)) == 1;
    }

    public void outboxPublicado(UUID eventId, Instant ahora) {
        jdbc.update("""
                UPDATE payment_outbox SET status = 'PUBLISHED', published_at = ?, last_error_code = NULL, updated_at = ?
                WHERE event_id = ? AND status = 'PENDING'
                """, utc(ahora), utc(ahora), eventId);
    }

    public void outboxReprogramar(UUID eventId, String codigo, Instant proxima, Instant ahora) {
        jdbc.update("""
                UPDATE payment_outbox SET next_attempt_at = ?, last_error_code = ?, updated_at = ?
                WHERE event_id = ? AND status = 'PENDING'
                """, utc(proxima), codigo, utc(ahora), eventId);
    }

    /** Ya está en la DLQ: la fila se conserva como evidencia con el último error. */
    public void outboxMuerto(UUID eventId, String codigo, Instant ahora) {
        jdbc.update("""
                UPDATE payment_outbox SET status = 'DEAD', last_error_code = ?, updated_at = ?
                WHERE event_id = ? AND status = 'PENDING'
                """, codigo, utc(ahora), eventId);
    }

    // ---------------------------------------------------------------- utilidades

    static OffsetDateTime utc(Instant instante) {
        return instante.truncatedTo(ChronoUnit.MICROS).atOffset(ZoneOffset.UTC);
    }

    private static Instant instante(OffsetDateTime valor) {
        return valor == null ? null : valor.toInstant();
    }

    private static String recortar(String valor, int maximo) {
        return valor == null || valor.length() <= maximo ? valor : valor.substring(0, maximo);
    }
}
