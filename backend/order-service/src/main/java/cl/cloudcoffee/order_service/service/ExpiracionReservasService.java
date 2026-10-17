package cl.cloudcoffee.order_service.service;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.order_service.model.Compra;
import cl.cloudcoffee.order_service.model.EstadoCompra;
import cl.cloudcoffee.order_service.model.EstadoPago;
import cl.cloudcoffee.order_service.model.EstadoReserva;
import cl.cloudcoffee.order_service.model.Reserva;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.order_service.repository.PagoRepository;
import cl.cloudcoffee.order_service.repository.ReservaRepository;

/** Libera el stock de compras pendientes cuyas reservas vencieron. */
@Service
public class ExpiracionReservasService {

    private static final Logger LOGGER = LoggerFactory.getLogger(ExpiracionReservasService.class);

    private final CompraRepository compraRepository;
    private final PagoRepository pagoRepository;
    private final ReservaRepository reservaRepository;
    private final PagoService pagoService;
    private final Clock clock;

    public ExpiracionReservasService(CompraRepository compraRepository, PagoRepository pagoRepository,
            ReservaRepository reservaRepository, PagoService pagoService, Clock clock) {
        this.compraRepository = compraRepository;
        this.pagoRepository = pagoRepository;
        this.reservaRepository = reservaRepository;
        this.pagoService = pagoService;
        this.clock = clock;
    }

    public List<UUID> comprasVencidas() {
        return reservaRepository.findComprasConReservasVencidas(clock.instant());
    }

    /**
     * Cada compra se expira en su propia transacción: un error en una no impide
     * expirar las demás. Devuelve true si la compra quedó EXPIRADA.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean expirarCompra(UUID compraId) {
        Compra compra = compraRepository.findForUpdate(compraId).orElse(null);
        Instant ahora = clock.instant();
        // Se revalida con la compra bloqueada: un pago pudo resolverla mientras tanto.
        if (compra == null || !compra.estaPendienteDePago()) {
            return false;
        }
        List<Reserva> activas = reservaRepository.findByCompraIdAndEstado(compraId, EstadoReserva.ACTIVA);
        if (activas.stream().noneMatch(reserva -> reserva.estaVencida(ahora))) {
            return false;
        }

        var pendiente = pagoRepository.findFirstByCompraIdAndEstado(compraId, EstadoPago.PENDIENTE);
        if (pendiente.isPresent()) {
            // Rechaza el pago, libera las reservas y publica el resultado.
            pagoService.expirar(pendiente.get().getId());
        } else {
            activas.forEach(Reserva::liberar);
            compra.cerrar(EstadoCompra.EXPIRADA);
        }
        LOGGER.info("Compra {} expirada: reservas liberadas", compraId);
        return true;
    }
}
