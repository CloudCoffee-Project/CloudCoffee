package cl.cloudcoffee.order_service.service;

import static cl.cloudcoffee.order_service.persistence.JdbcInstants.utc;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import cl.cloudcoffee.order_service.model.Pago;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago.CheckoutEncontrado;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago.CheckoutInexistente;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago.ConsultaNoDisponible;
import cl.cloudcoffee.order_service.service.ResultadoExternoService.ResultadoExterno;

/**
 * INT2-113: conciliación de pagos externos tras un reinicio, un evento perdido o enviado a la DLQ.
 *
 * <ol>
 * <li>Pagos pendientes sin checkout (Order cayó o Payment no respondió): se reintenta el inicio con la misma
 * clave y carga; Payment no crea una segunda preferencia.</li>
 * <li>Pagos con checkout: se consulta su intención en Payment cada {@code reconciliation-interval} y, al
 * vencer la compra, una última vez antes de vencerla localmente. Un resultado más nuevo se aplica igual que un
 * evento. Los pagos cerrados se siguen consultando durante {@code late-approval-window} para detectar
 * aprobaciones tardías.</li>
 * </ol>
 * Sin proveedor externo configurado no hace nada.
 */
@Service
public class ReconciliacionPagosExternos {

    private static final Logger LOG = LoggerFactory.getLogger(ReconciliacionPagosExternos.class);
    private static final int LOTE = 20;

    private final JdbcTemplate jdbc;
    private final PasarelaPago pasarela;
    private final PagoSandboxService sandbox;
    private final ResultadoExternoService externos;
    private final Clock clock;
    private final Duration intervalo;
    private final Duration ventanaTardia;

    public ReconciliacionPagosExternos(JdbcTemplate jdbc, PasarelaPago pasarela, PagoSandboxService sandbox,
            ResultadoExternoService externos, Clock clock,
            @Value("${cloudcoffee.pagos.reconciliation-interval:PT2M}") Duration intervalo,
            @Value("${cloudcoffee.pagos.late-approval-window:P3D}") Duration ventanaTardia) {
        this.jdbc = jdbc;
        this.pasarela = pasarela;
        this.sandbox = sandbox;
        this.externos = externos;
        this.clock = clock;
        this.intervalo = intervalo;
        this.ventanaTardia = ventanaTardia;
    }

    public void conciliar() {
        if (!pasarela.esExterna()) return;
        Instant ahora = clock.instant();
        // 1. Checkouts nunca obtenidos (los 5 s evitan competir con la solicitud que lo está creando).
        for (UUID id : jdbc.queryForList("""
                SELECT p.id FROM pagos p JOIN compras c ON c.id = p.compra_id
                WHERE p.proveedor=? AND p.estado='PENDIENTE' AND p.preferencia_id IS NULL
                  AND c.estado='PENDIENTE_PAGO' AND c.reserva_expira_at>? AND p.created_at<=?
                ORDER BY p.created_at, p.id LIMIT ?
                """, UUID.class, Pago.PROVEEDOR_SANDBOX, utc(ahora), utc(ahora.minusSeconds(5)), LOTE)) {
            try {
                sandbox.asegurarPreferencia(id);
            } catch (RuntimeException error) {
                LOG.warn("No se pudo obtener el checkout del pago {}: {}", id, error.getClass().getSimpleName());
            }
        }
        // 2. Consulta periódica del resultado en Payment.
        // consultado_at se relee y se compara tal cual (TIMESTAMP sin zona en UTC, ver JdbcInstants).
        record Candidato(UUID pagoId, UUID compraId, LocalDateTime consultadoAt) {
        }
        var candidatos = jdbc.query("""
                SELECT p.id, p.compra_id, p.consultado_at FROM pagos p JOIN compras c ON c.id = p.compra_id
                WHERE p.proveedor=? AND p.payment_id IS NOT NULL
                  AND (p.estado='PENDIENTE' OR (p.estado IN ('APROBADO', 'RECHAZADO') AND c.reserva_expira_at>?))
                  AND (p.consultado_at IS NULL OR p.consultado_at<=?
                       OR (p.estado='PENDIENTE' AND c.reserva_expira_at<=? AND p.consultado_at<c.reserva_expira_at))
                ORDER BY COALESCE(p.consultado_at, p.created_at), p.id LIMIT ?
                """, (rs, n) -> new Candidato(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class),
                        rs.getObject(3, LocalDateTime.class)),
                Pago.PROVEEDOR_SANDBOX, utc(ahora.minus(ventanaTardia)), utc(ahora.minus(intervalo)), utc(ahora), LOTE);
        for (Candidato candidato : candidatos) {
            // Reclamo optimista: entre réplicas, solo una consulta cada pago en cada ronda.
            int reclamado = candidato.consultadoAt() == null
                    ? jdbc.update("UPDATE pagos SET consultado_at=? WHERE id=? AND consultado_at IS NULL", utc(ahora), candidato.pagoId())
                    : jdbc.update("UPDATE pagos SET consultado_at=? WHERE id=? AND consultado_at=?", utc(ahora),
                            candidato.pagoId(), candidato.consultadoAt());
            if (reclamado != 1) continue;
            try {
                switch (pasarela.consultarCheckout(candidato.compraId())) {
                    case CheckoutEncontrado encontrado -> {
                        var checkout = encontrado.checkout();
                        if (!"pendiente".equals(checkout.estado())) {
                            externos.aplicar(new ResultadoExterno(null, checkout.paymentId(), checkout.compraId(),
                                    checkout.clienteId(), checkout.estado(), null, checkout.montoTotal(),
                                    checkout.version(), null));
                        }
                    }
                    case CheckoutInexistente inexistente ->
                            LOG.error("Payment no conoce la intención del pago {}; requiere revisión", candidato.pagoId());
                    case ConsultaNoDisponible noDisponible ->
                            LOG.warn("No se pudo consultar el pago {} en Payment: {}", candidato.pagoId(), noDisponible.motivo());
                }
            } catch (RuntimeException error) {
                LOG.warn("No se pudo conciliar el pago {}: {}", candidato.pagoId(), error.getClass().getSimpleName());
            }
        }
    }
}
