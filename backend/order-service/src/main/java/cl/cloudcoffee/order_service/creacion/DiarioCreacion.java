package cl.cloudcoffee.order_service.creacion;

import cl.cloudcoffee.order_service.dto.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.json.JsonMapper;

/** Solo el coordinador invoca estas escrituras, dentro de una transacción local corta por paso. */
@Repository
public class DiarioCreacion {
    private final JdbcTemplate jdbc;
    private final JsonMapper json;
    public DiarioCreacion(JdbcTemplate jdbc, JsonMapper json) { this.jdbc = jdbc; this.json = json; }
    public JdbcTemplate jdbc() { return jdbc; }
    public JsonMapper json() { return json; }

    record Registro(UUID id, UUID usuario, String hash, String solicitud, String fase, String plan,
            String respuesta, Integer status, String location, String trace, Instant creadoAt) {}

    Registro buscar(UUID id, boolean bloquear) {
        try {
            return jdbc.queryForObject("SELECT * FROM creacion_compras WHERE id=?" + (bloquear ? " FOR UPDATE NOWAIT" : ""),
                (rs, n) -> new Registro(rs.getObject("id", UUID.class), rs.getObject("usuario_id", UUID.class),
                        rs.getString("hash_cuerpo"), rs.getString("solicitud"), rs.getString("fase"),
                        rs.getString("plan"), rs.getString("respuesta"), (Integer) rs.getObject("status"),
                        rs.getString("location"), rs.getString("trace_id"), rs.getTimestamp("created_at").toInstant()), id);
        } catch (org.springframework.jdbc.UncategorizedSQLException error) {
            // El traductor SQLState de Spring no clasifica lock_not_available (55P03).
            if (bloquear && "55P03".equals(error.getSQLException().getSQLState()))
                throw new org.springframework.dao.CannotAcquireLockException("Creación en curso", error);
            throw error;
        }
    }

    void guardarPlan(UUID id, PlanCompra plan) {
        jdbc.update("UPDATE creacion_compras SET fase='RESERVANDO', plan=?, updated_at=? WHERE id=?",
                json.writeValueAsString(plan), Timestamp.from(Instant.now()), id);
    }

    void terminar(UUID id, int status, String body, String location) {
        jdbc.update("UPDATE creacion_compras SET fase='TERMINADA', status=?, respuesta=?, location=?, updated_at=? WHERE id=?",
                status, body, location, Timestamp.from(Instant.now()), id);
    }

    CompraResponse materializar(Registro registro, PlanCompra plan) {
        boolean revision = plan.grupos.stream().anyMatch(g -> g.fase.equals("REVISION"));
        long total = plan.grupos.stream().flatMap(g -> g.items.stream())
                .mapToLong(i -> i.oferta.precioUnitario().longValueExact() * i.cantidad).sum();
        jdbc.update("""
                INSERT INTO compras (id, usuario_id, monto_total, estado, moneda, reserva_expira_at, updated_at, version, created_at)
                VALUES (?, ?, ?, ?, 'CLP', ?, ?, 0, ?)
                """, plan.compraId, registro.usuario(), total, revision ? "REVISION_REQUERIDA" : "PENDIENTE_PAGO",
                Timestamp.from(plan.venceAt), Timestamp.from(plan.creadoAt), Timestamp.from(plan.creadoAt));
        List<OrdenResponse> ordenes = new ArrayList<>();
        for (var grupo : plan.grupos) {
            long monto = grupo.items.stream().mapToLong(i -> i.oferta.precioUnitario().longValueExact() * i.cantidad).sum();
            String estado = grupo.fase.equals("REVISION") ? "revision_requerida" : "pendiente_pago";
            String codigo = "CC-" + grupo.ordenId.toString().replace("-", "").toUpperCase(Locale.ROOT);
            jdbc.update("""
                    INSERT INTO ordenes (id, compra_id, codigo_orden, cafeteria_id, cafeteria_nombre, estado,
                        monto_total, moneda, reserva_expira_at, created_at, updated_at, version)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'CLP', ?, ?, ?, 0)
                    """, grupo.ordenId, plan.compraId, codigo, grupo.cafeteriaId, grupo.cafeteriaNombre,
                    estado.toUpperCase(Locale.ROOT), monto, Timestamp.from(plan.venceAt),
                    Timestamp.from(plan.creadoAt), Timestamp.from(plan.creadoAt));
            List<OrdenItemResponse> items = new ArrayList<>();
            for (var item : grupo.items) {
                var oferta = item.oferta;
                long precio = oferta.precioUnitario().longValueExact();
                jdbc.update("""
                        INSERT INTO orden_items (id, orden_id, oferta_id, producto_id, producto_nombre,
                            cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """, item.itemId, grupo.ordenId, oferta.ofertaId(), oferta.productoId(), oferta.productoNombre(),
                        item.cantidad, precio, precio * item.cantidad);
                if (grupo.fase.equals("LISTA")) {
                    jdbc.update("INSERT INTO orden_reservas (orden_id, oferta_id, reserva_id, intento_id) VALUES (?, ?, ?, ?)",
                            grupo.ordenId, oferta.ofertaId(), item.reservaId, registro.id());
                }
                items.add(new OrdenItemResponse(item.itemId, oferta.ofertaId(), oferta.productoId(),
                        oferta.productoNombre(), item.cantidad, precio, precio * item.cantidad));
            }
            items.sort(Comparator.comparing(i -> i.ordenItemId().toString()));
            ordenes.add(new OrdenResponse(grupo.ordenId, plan.compraId, codigo, grupo.cafeteriaId,
                    grupo.cafeteriaNombre, estado, monto, "CLP", List.copyOf(items), plan.venceAt, null, null,
                    plan.creadoAt, plan.creadoAt, 1));
            var payload = new LinkedHashMap<String, Object>();
            payload.put("compraId", plan.compraId);
            payload.put("ordenId", grupo.ordenId);
            payload.put("clienteId", registro.usuario());
            payload.put("cafeteriaId", grupo.cafeteriaId);
            payload.put("estadoAnterior", null);
            payload.put("estado", estado);
            payload.put("version", 1);
            evento(registro, "order.orden.estado-cambiado.v1", payload);
        }
        ordenes.sort(Comparator.comparing((OrdenResponse o) -> o.ordenId().toString()).reversed());
        var compra = new CompraResponse(plan.compraId, registro.usuario(), revision ? "revision_requerida" : "pendiente_pago",
                total, "CLP", List.copyOf(ordenes), null, plan.venceAt, plan.creadoAt, plan.creadoAt, 1);
        evento(registro, "order.compra.creada.v1", Map.of("compraId", plan.compraId, "clienteId", registro.usuario(),
                "estado", compra.estado(), "montoTotal", total, "moneda", "CLP",
                "ordenIds", ordenes.stream().map(OrdenResponse::ordenId).toList(), "version", 1));
        return compra;
    }

    private void evento(Registro registro, String tipo, Map<String, Object> payload) {
        UUID id = UUID.randomUUID();
        var envelope = Map.of("eventId", id, "timestamp", registro.creadoAt(), "traceId", registro.trace(),
                "eventType", tipo, "payload", payload);
        jdbc.update("INSERT INTO order_outbox (event_id, event_type, cuerpo, created_at) VALUES (?, ?, ?, ?)",
                id, tipo, json.writeValueAsString(envelope), Timestamp.from(registro.creadoAt()));
    }
}
