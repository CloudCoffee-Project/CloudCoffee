package cl.cloudcoffee.order_service.service;

import static cl.cloudcoffee.order_service.persistence.JdbcInstants.utc;

import java.time.Clock;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Reanuda aprobaciones y liberaciones pendientes, y vence los pagos cuyo plazo terminó. */
@Component
@ConditionalOnProperty(name = "cloudcoffee.pagos.recovery-enabled", havingValue = "true", matchIfMissing = true)
public class RecuperacionPagos {
    private static final Logger LOG = LoggerFactory.getLogger(RecuperacionPagos.class);
    private final JdbcTemplate jdbc;
    private final ResultadoPagoService resultados;
    private final Clock clock;

    public RecuperacionPagos(JdbcTemplate jdbc, ResultadoPagoService resultados, Clock clock) {
        this.jdbc = jdbc; this.resultados = resultados; this.clock = clock;
    }

    @Scheduled(fixedDelayString = "${cloudcoffee.pagos.scan-ms:2000}", initialDelayString = "${cloudcoffee.pagos.scan-ms:2000}")
    public void recuperar() {
        // Los dos segundos evitan competir con la solicitud que acaba de decidir la aprobación.
        for (UUID id : jdbc.queryForList("""
                SELECT id FROM pagos WHERE estado='PENDIENTE' AND motivo='PROCESANDO_STOCK'
                AND created_at<=? ORDER BY created_at, id LIMIT 20
                """, UUID.class, utc(clock.instant().minusSeconds(2)))) {
            try { resultados.resolverAprobacion(id); }
            catch (RuntimeException error) { LOG.error("No se pudo reanudar la aprobación del pago {}", id, error); }
        }
        for (UUID id : jdbc.queryForList("""
                SELECT p.id FROM pagos p JOIN compras c ON c.id = p.compra_id
                WHERE p.estado='PENDIENTE' AND (p.motivo IS NULL OR p.motivo<>'PROCESANDO_STOCK')
                AND c.estado='PENDIENTE_PAGO' AND c.reserva_expira_at<=?
                AND EXISTS (SELECT 1 FROM ordenes o JOIN orden_reservas r ON r.orden_id = o.id WHERE o.compra_id = c.id)
                ORDER BY c.reserva_expira_at, p.id LIMIT 20
                """, UUID.class, utc(clock.instant()))) {
            try { resultados.vencerPendiente(id); }
            catch (RuntimeException error) { LOG.error("No se pudo vencer el pago {}", id, error); }
        }
        resultados.liberarPendientes();
    }
}
