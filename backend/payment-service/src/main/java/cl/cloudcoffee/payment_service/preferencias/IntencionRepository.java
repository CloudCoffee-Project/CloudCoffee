package cl.cloudcoffee.payment_service.preferencias;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * Intención y preferencia (tablas de V1). Cada transición es un UPDATE condicionado por versión y estado:
 * si dos solicitudes compiten, solo una gana el derecho a llamar al proveedor o a guardar su resultado.
 */
@Repository
public class IntencionRepository {

    private static final String SELECT = """
            SELECT i.id, i.compra_id, i.cliente_id, i.idempotency_key, i.request_hash, i.request_payload, i.amount,
                   i.external_reference, i.return_channel, i.status, i.expires_at, i.updated_at, i.version,
                   p.provider_preference_id, p.init_point
            FROM payment_intent i LEFT JOIN payment_preference p ON p.payment_intent_id = i.id
            """;

    private final JdbcTemplate jdbc;

    public IntencionRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Intencion> porClave(UUID clave) {
        return jdbc.query(SELECT + " WHERE i.idempotency_key = ?", this::mapear, clave).stream().findFirst();
    }

    public Optional<Intencion> porCompra(UUID compraId) {
        return jdbc.query(SELECT + " WHERE i.compra_id = ?", this::mapear, compraId).stream().findFirst();
    }

    public Intencion porId(UUID id) {
        return jdbc.query(SELECT + " WHERE i.id = ?", this::mapear, id).stream().findFirst().orElseThrow();
    }

    /** Inserta en CREATING. La referencia externa estable es el propio ID de la intención. */
    public void insertar(UUID id, UUID clave, SolicitudPreferencia solicitud, String hash, String payload, Instant ahora) {
        jdbc.update("""
                INSERT INTO payment_intent (id, compra_id, cliente_id, idempotency_key, request_hash, request_payload,
                    amount, currency, provider, environment, external_reference, return_channel, status, expires_at,
                    created_at, updated_at, version)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'CLP', 'mercadopago_sandbox', 'sandbox', ?, ?, 'CREATING', ?, ?, ?, 0)
                """, id, solicitud.compraId(), solicitud.clienteId(), clave, hash, payload, solicitud.montoTotal(),
                id.toString(), solicitud.canalRetorno(), utc(solicitud.expiraAt()), utc(ahora), utc(ahora));
    }

    /**
     * Toma el derecho exclusivo a hablar con el proveedor. Queda en REQUIRES_RECONCILIATION antes del POST:
     * si el proceso cae a mitad de la llamada, la próxima solicitud concilia en vez de crear a ciegas.
     */
    public boolean reclamar(UUID id, long version, String estadoActual, Instant ahora) {
        return jdbc.update("""
                UPDATE payment_intent SET status = 'REQUIRES_RECONCILIATION', version = version + 1, updated_at = ?
                WHERE id = ? AND version = ? AND status = ?
                """, utc(ahora), id, version, estadoActual) == 1;
    }

    /** El proveedor confirmó que no creó nada: se puede volver a intentar sin conciliar. */
    public boolean liberar(UUID id, long version, Instant ahora) {
        return jdbc.update("""
                UPDATE payment_intent SET status = 'CREATING', version = version + 1, updated_at = ?
                WHERE id = ? AND version = ? AND status = 'REQUIRES_RECONCILIATION'
                """, utc(ahora), id, version) == 1;
    }

    /** Persiste la preferencia y deja la intención pendiente de pago, en una sola transacción. */
    @Transactional
    public boolean guardarPreferencia(UUID id, long version, String preferenciaId, String checkout, Instant ahora) {
        int filas = jdbc.update("""
                UPDATE payment_intent SET status = 'PENDING', version = version + 1, updated_at = ?
                WHERE id = ? AND version = ? AND status IN ('CREATING', 'REQUIRES_RECONCILIATION')
                """, utc(ahora), id, version);
        if (filas != 1) return false;
        jdbc.update("""
                INSERT INTO payment_preference (id, payment_intent_id, provider_preference_id, init_point, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """, UUID.randomUUID(), id, preferenciaId, checkout, utc(ahora), utc(ahora));
        return true;
    }

    private Intencion mapear(ResultSet rs, int fila) throws SQLException {
        return new Intencion(rs.getObject("id", UUID.class), rs.getObject("compra_id", UUID.class),
                rs.getObject("cliente_id", UUID.class), rs.getObject("idempotency_key", UUID.class),
                rs.getString("request_hash"), rs.getString("request_payload"), rs.getLong("amount"),
                rs.getString("external_reference"), rs.getString("return_channel"), rs.getString("status"),
                rs.getObject("expires_at", OffsetDateTime.class).toInstant(),
                rs.getObject("updated_at", OffsetDateTime.class).toInstant(), rs.getLong("version"),
                rs.getString("provider_preference_id"), rs.getString("init_point"));
    }

    private static OffsetDateTime utc(Instant instante) {
        return instante.truncatedTo(ChronoUnit.MICROS).atOffset(ZoneOffset.UTC);
    }

    public record Intencion(UUID id, UUID compraId, UUID clienteId, UUID clave, String hash, String payload,
            long monto, String referenciaExterna, String canal, String estado, Instant expiraAt, Instant actualizadaAt,
            long version, String preferenciaId, String initPoint) {
    }
}
