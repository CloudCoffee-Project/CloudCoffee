package cl.cloudcoffee.order_service.controller;

import java.util.UUID;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * INT2-129 (contrato INT2-109): Auth pregunta, antes de dar de baja una cuenta, si el usuario tiene compras
 * sin cerrar. Solo con el token interno; Gateway no la publica (solo enruta {@code /v1}).
 *
 * <p>Una compra está en curso si:
 * <ul>
 *   <li>está en {@code REVISION_REQUERIDA} o {@code PENDIENTE_PAGO};</li>
 *   <li>tiene una orden pagada aún no entregada ni cerrada ({@code PAGADO}, {@code LISTO_PARA_RETIRO} o
 *       {@code NO_RETIRADO_PENDIENTE_REVISION});</li>
 *   <li>o su pago sigue {@code PENDIENTE} o en {@code REQUIERE_CONCILIACION}: puede haber dinero del cliente
 *       por resolver, así que la baja espera a que se concilie.</li>
 * </ul>
 * Entregadas, no retiradas en firme y canceladas con su pago cerrado no impiden la baja.
 */
@RestController
public class InternalComprasEnCursoController {

    static final String SQL = """
            SELECT COUNT(*) FROM compras c
            WHERE c.usuario_id = ?
              AND (c.estado IN ('REVISION_REQUERIDA', 'PENDIENTE_PAGO')
                   OR EXISTS (SELECT 1 FROM ordenes o WHERE o.compra_id = c.id
                              AND o.estado IN ('PAGADO', 'LISTO_PARA_RETIRO', 'NO_RETIRADO_PENDIENTE_REVISION'))
                   OR EXISTS (SELECT 1 FROM pagos p WHERE p.compra_id = c.id
                              AND p.estado IN ('PENDIENTE', 'REQUIERE_CONCILIACION')))
            """;

    private final JdbcTemplate jdbc;

    public InternalComprasEnCursoController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record ComprasEnCurso(UUID usuarioId, boolean enCurso, long compras) {
    }

    @GetMapping("/internal/servicios/compras/usuarios/{usuarioId}/en-curso")
    @Transactional(readOnly = true)
    public ResponseEntity<ComprasEnCurso> enCurso(@PathVariable UUID usuarioId) {
        Long compras = jdbc.queryForObject(SQL, Long.class, usuarioId);
        long total = compras == null ? 0 : compras;
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new ComprasEnCurso(usuarioId, total > 0, total));
    }
}
