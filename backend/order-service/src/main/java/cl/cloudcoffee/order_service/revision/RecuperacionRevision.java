package cl.cloudcoffee.order_service.revision;

import static cl.cloudcoffee.order_service.persistence.JdbcInstants.utc;
import java.time.Clock;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "cloudcoffee.revision.recovery-enabled", havingValue = "true", matchIfMissing = true)
public class RecuperacionRevision {
    private static final Logger LOG = LoggerFactory.getLogger(RecuperacionRevision.class);
    private final DiarioRevision diario;
    private final RevisionCompraService revisiones;
    private final Clock clock;
    public RecuperacionRevision(DiarioRevision diario, RevisionCompraService revisiones, Clock clock) {
        this.diario = diario; this.revisiones = revisiones; this.clock = clock;
    }
    @Scheduled(fixedDelayString = "${cloudcoffee.revision.scan-ms:2000}", initialDelayString = "${cloudcoffee.revision.scan-ms:2000}")
    public void recuperar() {
        var ids = diario.jdbc().query("""
                SELECT id FROM revisiones_compra WHERE fase='PENDIENTE' AND updated_at<=? ORDER BY updated_at, id LIMIT 20
                """, (rs, n) -> rs.getObject(1, UUID.class), utc(clock.instant().minusSeconds(2)));
        for (UUID id : ids) try {
            for (int paso = 0; paso < 10; paso++) if (revisiones.avanzar(id) != null) break;
        } catch (PessimisticLockingFailureException | QueryTimeoutException ocupada) { /* otro worker posee la compra */ }
        catch (RuntimeException error) { LOG.error("No se pudo recuperar la revisión {}", id, error); }
    }
}
