package cl.cloudcoffee.order_service.service;

import static cl.cloudcoffee.order_service.persistence.JdbcInstants.utc;

import cl.cloudcoffee.order_service.creacion.CatalogoCompras;
import cl.cloudcoffee.order_service.dto.CompraResponse;
import cl.cloudcoffee.order_service.dto.OrdenResponse;
import cl.cloudcoffee.order_service.dto.PagoResponse;
import cl.cloudcoffee.order_service.model.EstadoPago;
import cl.cloudcoffee.order_service.model.MotivoPago;
import cl.cloudcoffee.order_service.model.Pago;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.order_service.repository.PagoRepository;
import cl.cloudcoffee.order_service.revision.EventosRevision;
import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * INT2-77: mantiene coherentes el pago, la compra, sus órdenes y el stock. Un pago
 * pendiente con motivo PROCESANDO_STOCK es la decisión durable de aprobar: se reanuda
 * tras un reinicio y nunca se libera una reserva que ya pudo confirmarse.
 */
@Service
public class ResultadoPagoService {
    private static final Logger LOG = LoggerFactory.getLogger(ResultadoPagoService.class);
    private static final Duration PLAZO_RETIRO = Duration.ofHours(2);

    private final JdbcTemplate jdbc;
    private final PagoRepository pagos;
    private final CompraRepository compras;
    private final CatalogoCompras catalogo;
    private final ConsultaComprasService consultas;
    private final EventosRevision eventos;
    private final EntityManager em;
    private final Clock clock;
    private final TransactionTemplate tx;

    public ResultadoPagoService(JdbcTemplate jdbc, PagoRepository pagos, CompraRepository compras,
            CatalogoCompras catalogo, ConsultaComprasService consultas, EventosRevision eventos, EntityManager em,
            Clock clock, PlatformTransactionManager manager) {
        this.jdbc = jdbc; this.pagos = pagos; this.compras = compras; this.catalogo = catalogo;
        this.consultas = consultas; this.eventos = eventos; this.em = em; this.clock = clock;
        this.tx = new TransactionTemplate(manager);
    }

    /** Sin reservas no hay stock que confirmar ni plazo que vencer (compras mínimas de INT2-53/76). */
    boolean tieneReservas(UUID compraId) {
        return !reservasActivas(compraId).isEmpty();
    }

    /** Evento del pago recién creado; va en la misma transacción que lo inserta. */
    void publicarPago(Pago pago, UUID clienteId, String trace) {
        eventos.pago(PagoResponse.from(pago), clienteId, trace, ahora());
    }

    /** Requiere la compra bloqueada y el pago ya en su estado final. */
    void aplicarResultado(Pago pago, UUID clienteId, String trace) {
        aplicar(pago, clienteId, trace, List.of());
    }

    /**
     * Confirma las reservas de una aprobación decidida y resuelve el pago. Devuelve false
     * si Catalog no respondió: el pago sigue pendiente y se reintentará con los mismos IDs.
     *
     * Catalog aún no confirma un lote de forma atómica, así que se confirman una a una.
     * Comparten vencimiento y orden fijo, por lo que solo cruzar el plazo a mitad del
     * recorrido deja una confirmación parcial; se registra como error porque Catalog no
     * permite liberar una reserva confirmada.
     */
    public boolean resolverAprobacion(UUID pagoId) {
        var compraIds = jdbc.queryForList("SELECT compra_id FROM pagos WHERE id=? AND estado='PENDIENTE' AND motivo='PROCESANDO_STOCK'",
                UUID.class, pagoId);
        if (compraIds.isEmpty()) return false;
        UUID compraId = compraIds.getFirst();
        var confirmadas = new ArrayList<UUID>();
        boolean vencida = false;
        for (UUID reserva : reservasActivas(compraId)) {
            try {
                if (!catalogo.confirmar(reserva)) { vencida = true; break; }
            } catch (CatalogoCompras.NoDisponible noDisponible) {
                return false;
            }
            confirmadas.add(reserva);
        }
        boolean rechazar = vencida;
        Boolean rechazado = tx.execute(status -> {
            em.clear();
            var compra = compras.findForUpdate(compraId).orElseThrow();
            Pago pago = pagos.findById(pagoId).orElseThrow();
            // Otro worker pudo resolverlo mientras se llamaba a Catalog.
            if (pago.getEstado() != EstadoPago.PENDIENTE || pago.getMotivo() != MotivoPago.PROCESANDO_STOCK) return false;
            if (rechazar) {
                pago.aplicarResultado(EstadoPago.RECHAZADO, null);
                pago.registrarMotivo(MotivoPago.RESERVA_VENCIDA);
                if (!confirmadas.isEmpty()) LOG.error("Compra {} rechazada por vencimiento con {} reservas ya confirmadas: requieren revisión manual",
                        compraId, confirmadas.size());
            } else {
                pago.aplicarResultado(EstadoPago.APROBADO, null);
                pago.registrarMotivo(MotivoPago.APROBACION_SIMULADA);
            }
            aplicar(pago, compra.getUsuarioId(), pago.getTraceId() == null ? traceNuevo() : pago.getTraceId(), confirmadas);
            return rechazar;
        });
        if (Boolean.TRUE.equals(rechazado)) liberarPendientes(compraId);
        return true;
    }

    /** Rechaza un pago pendiente cuyo plazo común terminó. Repetirlo no tiene efecto. */
    public void vencerPendiente(UUID pagoId) {
        UUID compraId = tx.execute(status -> {
            em.clear();
            Pago leido = pagos.findById(pagoId).orElseThrow();
            UUID id = leido.getCompra().getId();
            var compra = compras.findForUpdate(id).orElseThrow();
            em.refresh(leido);
            if (leido.getEstado() != EstadoPago.PENDIENTE || leido.getMotivo() == MotivoPago.PROCESANDO_STOCK
                    || clock.instant().isBefore(compra.getReservaExpiraAt())) return null;
            leido.aplicarResultado(EstadoPago.RECHAZADO, null);
            leido.registrarMotivo(MotivoPago.RESERVA_VENCIDA);
            // Sin HTTP, el job abre su propia traza.
            aplicar(leido, compra.getUsuarioId(), traceNuevo(), List.of());
            return id;
        });
        if (compraId != null) liberarPendientes(compraId);
    }

    public void liberarPendientes(UUID compraId) {
        liberar(jdbc.queryForList("SELECT reserva_id FROM liberaciones_reserva WHERE compra_id=?", UUID.class, compraId));
    }

    public void liberarPendientes() {
        liberar(jdbc.queryForList("SELECT reserva_id FROM liberaciones_reserva ORDER BY created_at, reserva_id LIMIT 50", UUID.class));
    }

    private void liberar(List<UUID> reservas) {
        for (UUID reserva : reservas) {
            try {
                catalogo.liberar(reserva);
                jdbc.update("DELETE FROM liberaciones_reserva WHERE reserva_id=?", reserva);
            } catch (CatalogoCompras.NoDisponible noDisponible) {
                return; // Sigue pendiente; el próximo ciclo reintenta.
            }
        }
    }

    private void aplicar(Pago pago, UUID clienteId, String trace, List<UUID> confirmadas) {
        pagos.flush();
        PagoResponse resultado = PagoResponse.from(pago);
        UUID compraId = resultado.compraId();
        Instant ahora = ahora();
        boolean aprobado = pago.getEstado() == EstadoPago.APROBADO;
        em.clear();
        CompraResponse antes = consultas.compra(clienteId, compraId);
        if (aprobado) {
            jdbc.update("""
                    UPDATE ordenes SET estado='PAGADO', retiro_hasta=?, version=version+1, updated_at=?
                    WHERE compra_id=? AND estado='PENDIENTE_PAGO'
                    """, utc(ahora.plus(PLAZO_RETIRO)), utc(ahora), compraId);
        } else {
            for (UUID reserva : reservasActivas(compraId)) {
                if (confirmadas.contains(reserva)) continue;
                jdbc.update("INSERT INTO liberaciones_reserva (reserva_id, compra_id, created_at) VALUES (?, ?, ?)",
                        reserva, compraId, utc(ahora));
                jdbc.update("DELETE FROM orden_reservas WHERE reserva_id=?", reserva);
            }
            jdbc.update("""
                    UPDATE ordenes SET estado='CANCELADO', version=version+1, updated_at=?
                    WHERE compra_id=? AND estado='PENDIENTE_PAGO'
                    """, utc(ahora), compraId);
        }
        int cambiadas = jdbc.update(aprobado
                ? "UPDATE compras SET estado='PAGADO', version=version+1, updated_at=? WHERE id=? AND estado='PENDIENTE_PAGO'"
                : "UPDATE compras SET estado='CANCELADO', monto_total=0, version=version+1, updated_at=? WHERE id=? AND estado='PENDIENTE_PAGO'",
                utc(ahora), compraId);
        if (cambiadas != 1) throw new IllegalStateException("La compra cambió mientras se aplicaba el pago");
        em.clear();
        CompraResponse despues = consultas.compra(clienteId, compraId);
        eventos.pago(resultado, clienteId, trace, ahora);
        eventos.compra(antes, despues, trace, ahora);
        for (OrdenResponse anterior : antes.ordenes()) {
            OrdenResponse actual = despues.ordenes().stream()
                    .filter(orden -> orden.ordenId().equals(anterior.ordenId())).findFirst().orElseThrow();
            if (!actual.estado().equals(anterior.estado())) eventos.orden(anterior, actual, clienteId, trace, ahora);
        }
    }

    private List<UUID> reservasActivas(UUID compraId) {
        return jdbc.queryForList("""
                SELECT r.reserva_id FROM orden_reservas r JOIN ordenes o ON o.id = r.orden_id
                WHERE o.compra_id=? AND o.estado='PENDIENTE_PAGO' ORDER BY r.reserva_id
                """, UUID.class, compraId);
    }

    private Instant ahora() { return clock.instant().truncatedTo(ChronoUnit.MICROS); }

    /** La traza de la solicitud en curso o, si no existe, una propia. */
    static String trace() {
        String trace = MDC.get("traceId");
        return trace != null && trace.matches("[a-fA-F0-9]{32}") ? trace : traceNuevo();
    }

    private static String traceNuevo() { return UUID.randomUUID().toString().replace("-", ""); }
}
