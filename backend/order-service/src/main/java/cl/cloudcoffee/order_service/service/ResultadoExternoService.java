package cl.cloudcoffee.order_service.service;

import static cl.cloudcoffee.order_service.persistence.JdbcInstants.utc;

import java.time.Clock;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import cl.cloudcoffee.order_service.model.Compra;
import cl.cloudcoffee.order_service.model.EstadoCompra;
import cl.cloudcoffee.order_service.model.EstadoPago;
import cl.cloudcoffee.order_service.model.MotivoPago;
import cl.cloudcoffee.order_service.model.Pago;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.order_service.repository.PagoRepository;
import jakarta.persistence.EntityManager;

/**
 * INT2-113: aplica un resultado de payment-service ({@code payment.pago.resultado.v1} o una consulta de
 * conciliación) sobre el pago de Order. Reutiliza la confirmación/liberación durable de INT2-77
 * ({@link ResultadoPagoService}); aquí solo se decide qué hacer:
 *
 * <ul>
 * <li>{@code aprobado}: el pago queda pendiente con {@code procesando_stock} (decisión durable) y luego se
 * confirman todas las reservas; solo entonces pasa a aprobado y la compra a pagada. Si el stock ya no se puede
 * confirmar, requiere conciliación.</li>
 * <li>{@code rechazado}/{@code cancelado}/{@code vencido}: rechazo con su motivo; compra y órdenes se cancelan y
 * las reservas se liberan una sola vez.</li>
 * <li>{@code requiere_conciliacion}, o una aprobación sobre un pago ya rechazado o vencido (stock liberado):
 * el pago requiere conciliación, sin recrear reservas ni tocar el stock.</li>
 * </ul>
 * Cada evento se aplica una vez por {@code (consumidor, eventId)} y solo si su versión supera la última aplicada,
 * de modo que repetidos o desordenados no tienen efecto.
 */
@Service
public class ResultadoExternoService {

    public static final String CONSUMIDOR = "order.payment-results";
    private static final Logger LOG = LoggerFactory.getLogger(ResultadoExternoService.class);

    private final JdbcTemplate jdbc;
    private final PagoRepository pagos;
    private final CompraRepository compras;
    private final ResultadoPagoService resultados;
    private final EntityManager em;
    private final Clock clock;
    private final TransactionTemplate tx;

    public ResultadoExternoService(JdbcTemplate jdbc, PagoRepository pagos, CompraRepository compras,
            ResultadoPagoService resultados, EntityManager em, Clock clock, PlatformTransactionManager manager) {
        this.jdbc = jdbc;
        this.pagos = pagos;
        this.compras = compras;
        this.resultados = resultados;
        this.em = em;
        this.clock = clock;
        this.tx = new TransactionTemplate(manager);
    }

    /**
     * Resultado externo ya validado. {@code eventId} es null cuando proviene de una consulta de conciliación (la
     * versión basta para no repetir efectos). {@code motivo} puede ser null.
     */
    public record ResultadoExterno(UUID eventId, UUID paymentId, UUID compraId, UUID clienteId, String estado,
            String motivo, long montoTotal, long version, String traceId) {
    }

    public enum Efecto { APLICADO, SIN_CAMBIOS, DUPLICADO, OBSOLETO, DIFERIDO, DESCONOCIDO }

    /** El resultado contradice el pago de Order (otra intención, monto o cliente): no se aplica. */
    public static class ResultadoInconsistente extends RuntimeException {
        public ResultadoInconsistente(String mensaje) {
            super(mensaje);
        }
    }

    private enum Despues { NADA, CONFIRMAR, LIBERAR }

    private record Decision(Efecto efecto, Despues despues, UUID pagoId, UUID compraId) {
        static Decision de(Efecto efecto) {
            return new Decision(efecto, Despues.NADA, null, null);
        }
    }

    public Efecto aplicar(ResultadoExterno r) {
        Decision decision = tx.execute(status -> decidir(r));
        // Fuera de la transacción, como en INT2-77: Catalog se llama sin bloquear la compra.
        switch (decision.despues()) {
            case CONFIRMAR -> resultados.resolverAprobacion(decision.pagoId());
            case LIBERAR -> resultados.liberarPendientes(decision.compraId());
            case NADA -> {
            }
        }
        return decision.efecto();
    }

    private Decision decidir(ResultadoExterno r) {
        if (r.eventId() != null && yaConsumido(r.eventId())) return Decision.de(Efecto.DUPLICADO);
        em.clear();
        var encontrado = pagos.findByCompraId(r.compraId());
        if (encontrado.isEmpty() || !encontrado.get().esExterno()) {
            LOG.warn("Resultado de Payment para la compra {} sin pago externo en Order; se descarta", r.compraId());
            return registrar(r, Decision.de(Efecto.DESCONOCIDO));
        }
        Compra compra = compras.findForUpdate(r.compraId()).orElseThrow();
        Pago pago = encontrado.get();
        em.refresh(pago);
        if (pago.getPaymentId() != null && !pago.getPaymentId().equals(r.paymentId())) {
            throw new ResultadoInconsistente("La compra " + r.compraId() + " tiene otra intención de Payment");
        }
        if (pago.getMonto().longValueExact() != r.montoTotal() || !compra.getUsuarioId().equals(r.clienteId())) {
            throw new ResultadoInconsistente("Monto o cliente distintos al pago de la compra " + r.compraId());
        }
        if (r.version() <= pago.getPaymentVersion()) return registrar(r, Decision.de(Efecto.OBSOLETO));
        // Order pudo caer antes de guardar la correlación: el evento la completa.
        if (pago.getPaymentId() == null) pago.registrarCheckout(r.paymentId(), null, null);

        boolean procesandoStock = pago.getEstado() == EstadoPago.PENDIENTE && pago.getMotivo() == MotivoPago.PROCESANDO_STOCK;
        String trace = r.traceId() != null ? r.traceId() : pago.getTraceId() != null ? pago.getTraceId() : ResultadoPagoService.trace();
        Decision decision = switch (r.estado()) {
            case "pendiente" -> Decision.de(Efecto.SIN_CAMBIOS);
            case "aprobado" -> aprobado(pago, procesandoStock, compra, trace);
            case "rechazado", "cancelado", "vencido" -> cierre(pago, procesandoStock, r.estado(), compra, trace);
            case "requiere_conciliacion" -> {
                // Una aprobación en curso termina primero; la conciliación periódica vuelve a consultar.
                if (procesandoStock) yield Decision.de(Efecto.DIFERIDO);
                if (pago.getEstado() == EstadoPago.REQUIERE_CONCILIACION) yield Decision.de(Efecto.SIN_CAMBIOS);
                yield conciliacion(pago, compra, r.motivo() == null ? "requiere_conciliacion" : r.motivo(), trace);
            }
            default -> throw new ResultadoInconsistente("Estado de Payment desconocido: " + r.estado());
        };
        pagos.flush();
        // Por SQL: aplicarResultado (INT2-77) limpia el contexto y la entidad puede quedar desconectada.
        if (decision.efecto() != Efecto.DIFERIDO) {
            jdbc.update("UPDATE pagos SET payment_version=? WHERE id=? AND payment_version<?",
                    r.version(), pago.getId(), r.version());
        }
        return registrar(r, decision);
    }

    private Decision aprobado(Pago pago, boolean procesandoStock, Compra compra, String trace) {
        if (procesandoStock) return new Decision(Efecto.APLICADO, Despues.CONFIRMAR, pago.getId(), null);
        return switch (pago.getEstado()) {
            case PENDIENTE -> {
                // Decisión durable de aprobar: si el proceso cae, RecuperacionPagos la retoma (INT2-77).
                pago.registrarMotivo(MotivoPago.PROCESANDO_STOCK);
                yield new Decision(Efecto.APLICADO, Despues.CONFIRMAR, pago.getId(), null);
            }
            // Order ya liberó las reservas (vencimiento o rechazo): no se recrean; conciliación manual.
            case RECHAZADO -> conciliacion(pago, compra, "aprobacion_con_stock_liberado", trace);
            case APROBADO, REQUIERE_CONCILIACION -> Decision.de(Efecto.SIN_CAMBIOS);
        };
    }

    private Decision cierre(Pago pago, boolean procesandoStock, String estado, Compra compra, String trace) {
        if (procesandoStock) return Decision.de(Efecto.DIFERIDO);
        if (pago.getEstado() != EstadoPago.PENDIENTE) return Decision.de(Efecto.SIN_CAMBIOS);
        pago.aplicarResultado(EstadoPago.RECHAZADO, null);
        pago.registrarMotivo(switch (estado) {
            case "cancelado" -> MotivoPago.PROVEEDOR_CANCELADO;
            case "vencido" -> MotivoPago.RESERVA_VENCIDA;
            default -> MotivoPago.PROVEEDOR_RECHAZADO;
        });
        // Cancela compra y órdenes y deja las liberaciones pendientes en la misma transacción (INT2-77).
        resultados.aplicarResultado(pago, compra.getUsuarioId(), trace);
        return new Decision(Efecto.APLICADO, Despues.LIBERAR, pago.getId(), compra.getId());
    }

    /**
     * Requiere conciliación: no se libera ni reintegra stock y no se cambia la compra; solo se publica el nuevo
     * estado del pago. Con el pago fuera de "aprobado", ninguna orden puede avanzar a retiro.
     */
    private Decision conciliacion(Pago pago, Compra compra, String motivo, String trace) {
        pago.requiereConciliacion(motivo);
        pagos.flush();
        resultados.publicarPago(pago, compra.getUsuarioId(), trace);
        LOG.error("Pago {} de la compra {} (estado {}) requiere conciliación: {}", pago.getId(), compra.getId(),
                compra.getEstado() == EstadoCompra.PAGADO ? "pagada" : compra.getEstado(), motivo);
        return Decision.de(Efecto.APLICADO);
    }

    private boolean yaConsumido(UUID eventId) {
        Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM eventos_consumidos WHERE consumidor=? AND event_id=?",
                Integer.class, CONSUMIDOR, eventId);
        return n != null && n > 0;
    }

    /** Deduplicación en la misma transacción que la decisión. */
    private Decision registrar(ResultadoExterno r, Decision decision) {
        if (r.eventId() != null) {
            jdbc.update("INSERT INTO eventos_consumidos (consumidor, event_id, event_type, resultado, created_at) VALUES (?, ?, ?, ?, ?)",
                    CONSUMIDOR, r.eventId(), "payment.pago.resultado.v1", decision.efecto().name(), utc(clock.instant()));
        }
        return decision;
    }
}
