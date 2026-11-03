package cl.cloudcoffee.order_service.creacion;

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
@ConditionalOnProperty(name = "cloudcoffee.creation.recovery-enabled", havingValue = "true", matchIfMissing = true)
public class RecuperacionCreacion {
    private static final Logger LOG = LoggerFactory.getLogger(RecuperacionCreacion.class);
    private final DiarioCreacion diario;
    private final CreacionCompraService service;
    private final Clock clock;
    public RecuperacionCreacion(DiarioCreacion diario, CreacionCompraService service, Clock clock) {
        this.diario = diario; this.service = service; this.clock = clock;
    }
    @Scheduled(fixedDelayString = "${cloudcoffee.creation.scan-ms:2000}", initialDelayString = "${cloudcoffee.creation.scan-ms:2000}")
    public void recuperar() {
        var pendientes = diario.jdbc().query("""
                SELECT id FROM creacion_compras WHERE fase <> 'TERMINADA' AND updated_at <= ?
                ORDER BY updated_at, id LIMIT 20
                """, (rs, n) -> rs.getObject(1, UUID.class), utc(clock.instant().minusSeconds(2)));
        for (UUID id : pendientes) {
            try {
                // Límite por operación para no monopolizar el worker con una compra grande.
                for (int paso = 0; paso < 10; paso++) if (service.avanzar(id) != null) break;
            } catch (PessimisticLockingFailureException | QueryTimeoutException ocupado) { /* otro worker avanza la misma operación */ }
            catch (RuntimeException error) { LOG.error("No se pudo recuperar la creación {}", id, error); }
        }
    }
}
