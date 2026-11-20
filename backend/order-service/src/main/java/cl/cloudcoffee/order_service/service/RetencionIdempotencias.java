package cl.cloudcoffee.order_service.service;

import static cl.cloudcoffee.order_service.persistence.JdbcInstants.utc;
import java.time.Clock;
import java.time.Duration;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Lotes pequeños con exclusión entre réplicas; no toca compras, pagos ni diarios de eventos. */
@Service
@ConditionalOnProperty(name = "cloudcoffee.idempotencia.enabled", havingValue = "true", matchIfMissing = true)
public class RetencionIdempotencias {
    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final Duration retencion;
    private final int lote;
    private final TransactionTemplate tx;

    public RetencionIdempotencias(JdbcTemplate jdbc, Clock clock, PlatformTransactionManager manager,
            @Value("${cloudcoffee.idempotencia.retention:P30D}") Duration retencion,
            @Value("${cloudcoffee.idempotencia.batch-size:100}") int lote) {
        if (retencion.compareTo(Duration.ofHours(24)) < 0) throw new IllegalArgumentException("La retención debe ser al menos 24 horas");
        if (lote < 1 || lote > 1000) throw new IllegalArgumentException("El lote debe estar entre 1 y 1000");
        this.jdbc = jdbc; this.clock = clock; this.retencion = retencion; this.lote = lote;
        this.tx = new TransactionTemplate(manager);
    }

    @Scheduled(fixedDelayString = "${cloudcoffee.idempotencia.cleanup-interval:PT1H}",
            initialDelayString = "${cloudcoffee.idempotencia.cleanup-interval:PT1H}")
    public void limpiar() {
        // Migraciones anteriores no conocían completed_at de pagos: observar finales por lotes,
        // otorgando toda la retención desde ahora. Nunca anticipar la fecha ni marcar pendientes.
        tx.executeWithoutResult(status -> {
            var ids = jdbc.queryForList("""
                SELECT i.id FROM idempotencia i WHERE i.completed_at IS NULL AND EXISTS (
                    SELECT 1 FROM pagos p WHERE i.ruta=CONCAT('/compras/', CAST(p.compra_id AS VARCHAR), '/pago')
                    AND p.estado IN ('APROBADO','RECHAZADO')) ORDER BY i.created_at, i.id LIMIT ? FOR UPDATE SKIP LOCKED
                """, UUID.class, lote);
            for (UUID id : ids) jdbc.update("UPDATE idempotencia SET completed_at=? WHERE id=? AND completed_at IS NULL", utc(clock.instant()), id);
        });
        depurar("creacion_compras", """
            fase='TERMINADA' AND NOT EXISTS (SELECT 1 FROM orden_reservas r WHERE r.intento_id=creacion_compras.id)
            AND NOT EXISTS (SELECT 1 FROM compras c WHERE creacion_compras.location=CONCAT('/v1/compras/', CAST(c.id AS VARCHAR))
                AND (c.estado IN ('REVISION_REQUERIDA','PENDIENTE_PAGO') OR c.revision_pendiente IS NOT NULL
                    OR EXISTS (SELECT 1 FROM liberaciones_reserva l WHERE l.compra_id=c.id)
                    OR EXISTS (SELECT 1 FROM pagos p WHERE p.compra_id=c.id AND p.estado IN ('PENDIENTE','REQUIERE_CONCILIACION'))))
            """);
        depurar("revisiones_compra", """
            fase='TERMINADA' AND NOT EXISTS (SELECT 1 FROM compras c WHERE c.revision_pendiente=revisiones_compra.id)
            AND NOT EXISTS (SELECT 1 FROM orden_reservas r WHERE r.intento_id=revisiones_compra.id)
            AND NOT EXISTS (SELECT 1 FROM liberaciones_reserva l WHERE l.compra_id=revisiones_compra.compra_id)
            AND NOT EXISTS (SELECT 1 FROM pagos p WHERE p.compra_id=revisiones_compra.compra_id AND p.estado IN ('PENDIENTE','REQUIERE_CONCILIACION'))
            """);
        depurar("idempotencia", """
            metodo='POST' AND EXISTS (SELECT 1 FROM pagos p JOIN compras c ON c.id=p.compra_id
                WHERE idempotencia.ruta=CONCAT('/compras/', CAST(c.id AS VARCHAR), '/pago')
                AND p.estado IN ('APROBADO','RECHAZADO') AND c.revision_pendiente IS NULL
                AND c.estado IN ('PAGADO','CANCELADO')
                AND NOT EXISTS (SELECT 1 FROM liberaciones_reserva l WHERE l.compra_id=c.id))
            """);
    }

    private void depurar(String tabla, String criterio) {
        // Nombres/criterios son constantes internas. Selección y borrado pertenecen a la misma TX.
        tx.executeWithoutResult(status -> {
            var ids = jdbc.queryForList("SELECT id FROM " + tabla + " WHERE completed_at<? AND " + criterio
                    + " ORDER BY completed_at,id LIMIT ? FOR UPDATE SKIP LOCKED", UUID.class,
                    utc(clock.instant().minus(retencion)), lote);
            for (UUID id : ids) jdbc.update("DELETE FROM " + tabla + " WHERE id=? AND " + criterio, id);
        });
    }
}
