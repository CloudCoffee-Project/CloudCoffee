package cl.cloudcoffee.order_service.revision;

import cl.cloudcoffee.errors.BusinessException;
import java.net.URI;
import static cl.cloudcoffee.order_service.persistence.JdbcInstants.utc;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.UncategorizedSQLException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.json.JsonMapper;

@Repository
public class DiarioRevision {
    private final JdbcTemplate jdbc;
    private final JsonMapper json;
    public DiarioRevision(JdbcTemplate jdbc, JsonMapper json) { this.jdbc = jdbc; this.json = json; }
    public JdbcTemplate jdbc() { return jdbc; }
    public JsonMapper json() { return json; }

    record Registro(UUID id, UUID compraId, UUID usuario, UUID ordenId, String accion, String ruta,
            String fase, String plan, Integer status, String respuesta, String trace) {}
    record CompraBloqueada(UUID usuario, UUID pendiente) {}

    UUID compraDeOrden(UUID orden) {
        var ids = jdbc.queryForList("SELECT compra_id FROM ordenes WHERE id=?", UUID.class, orden);
        if (ids.isEmpty()) throw noEncontrada(true);
        return ids.getFirst();
    }
    CompraBloqueada bloquear(UUID compra) {
        try {
            var resultados = jdbc.query("SELECT usuario_id, revision_pendiente FROM compras WHERE id=? FOR UPDATE NOWAIT",
                    (rs, n) -> new CompraBloqueada(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class)), compra);
            return resultados.isEmpty() ? null : resultados.getFirst();
        } catch (UncategorizedSQLException error) {
            if ("55P03".equals(error.getSQLException().getSQLState()))
                throw new CannotAcquireLockException("Compra ocupada", error);
            throw error;
        }
    }
    Registro buscar(UUID id) {
        return jdbc.queryForObject("SELECT * FROM revisiones_compra WHERE id=?", (rs, n) ->
                new Registro(rs.getObject("id", UUID.class), rs.getObject("compra_id", UUID.class),
                        rs.getObject("usuario_id", UUID.class), rs.getObject("orden_id", UUID.class),
                        rs.getString("accion"), rs.getString("ruta"), rs.getString("fase"), rs.getString("plan"),
                        (Integer) rs.getObject("status"), rs.getString("respuesta"), rs.getString("trace_id")), id);
    }
    List<UUID> previos(UUID usuario, String ruta, UUID clave) {
        return jdbc.queryForList("SELECT id FROM revisiones_compra WHERE usuario_id=? AND ruta=? AND clave=?",
                UUID.class, usuario, ruta, clave);
    }
    void insertar(UUID id, UUID compra, UUID usuario, UUID orden, String accion, String ruta, UUID clave,
            PlanRevision plan, String trace, Instant ahora) {
        jdbc.update("""
                INSERT INTO revisiones_compra (id, compra_id, usuario_id, orden_id, accion, ruta, clave, plan,
                    trace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, id, compra, usuario, orden, accion, ruta, clave, json.writeValueAsString(plan), trace,
                utc(ahora), utc(ahora));
    }
    void plan(UUID id, PlanRevision plan, Instant ahora) {
        jdbc.update("UPDATE revisiones_compra SET plan=?, updated_at=? WHERE id=?",
                json.writeValueAsString(plan), utc(ahora), id);
    }
    void terminar(Registro registro, int status, String cuerpo, Instant ahora) {
        jdbc.update("UPDATE revisiones_compra SET fase='TERMINADA', status=?, respuesta=?, updated_at=? WHERE id=?",
                status, cuerpo, utc(ahora), registro.id());
        jdbc.update("UPDATE compras SET revision_pendiente=NULL WHERE id=? AND revision_pendiente=?",
                registro.compraId(), registro.id());
    }
    static BusinessException noEncontrada(boolean orden) {
        String recurso = orden ? "orden" : "compra";
        return new BusinessException(HttpStatus.NOT_FOUND, URI.create("/problems/" + recurso + "-no-encontrada"),
                "Recurso no encontrado", "No existe una " + recurso + " con el identificador indicado.",
                orden ? "ORDEN_NO_ENCONTRADA" : "COMPRA_NO_ENCONTRADA");
    }
}
