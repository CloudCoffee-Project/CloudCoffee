package cl.cloudcoffee.order_service.service;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.order_service.model.Compra;
import cl.cloudcoffee.order_service.model.EstadoCompra;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Comprobar después de bloquear la compra: una decisión remota pendiente conserva la exclusión. */
@Component
public class OperacionCompraGuard {
    private final JdbcTemplate jdbc;
    public OperacionCompraGuard(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public void verificarInicioPago(Compra compra) {
        boolean ocupada = Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT revision_pendiente IS NOT NULL FROM compras WHERE id=?", Boolean.class, compra.getId()));
        if (ocupada || compra.getEstado() != EstadoCompra.PENDIENTE_PAGO) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/estado-invalido"),
                    "Estado inválido", "La compra no está disponible para iniciar un pago.", "ESTADO_INVALIDO");
        }
    }
}
