package cl.cloudcoffee.order_service.service;

import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.order_service.messaging.PagoFinalizado;
import cl.cloudcoffee.order_service.messaging.TraceIdProvider;
import cl.cloudcoffee.order_service.model.Compra;
import cl.cloudcoffee.order_service.model.EstadoCompra;
import cl.cloudcoffee.order_service.model.EstadoPago;
import cl.cloudcoffee.order_service.model.EstadoReserva;
import cl.cloudcoffee.order_service.model.Pago;
import cl.cloudcoffee.order_service.model.Reserva;
import cl.cloudcoffee.order_service.model.TransicionPagoInvalidaException;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago.RegistroPasarela;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago.SolicitudPago;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.order_service.repository.PagoRepository;
import cl.cloudcoffee.order_service.repository.ReservaRepository;

@Service
public class PagoService {

    public static final String MOTIVO_RESERVA_VENCIDA = "La reserva de stock venció antes de confirmar el pago.";

    private static final Set<EstadoPago> ACTIVOS = EnumSet.of(EstadoPago.PENDIENTE, EstadoPago.APROBADO);

    private final CompraRepository compraRepository;
    private final PagoRepository pagoRepository;
    private final ReservaRepository reservaRepository;
    private final PasarelaPago pasarela;
    private final ApplicationEventPublisher eventos;
    private final TraceIdProvider traceIds;
    private final Clock clock;

    public PagoService(CompraRepository compraRepository, PagoRepository pagoRepository,
            ReservaRepository reservaRepository, PasarelaPago pasarela, ApplicationEventPublisher eventos,
            TraceIdProvider traceIds, Clock clock) {
        this.compraRepository = compraRepository;
        this.pagoRepository = pagoRepository;
        this.reservaRepository = reservaRepository;
        this.pasarela = pasarela;
        this.eventos = eventos;
        this.traceIds = traceIds;
        this.clock = clock;
    }

    /**
     * Abre un pago PENDIENTE por el monto total de la compra. Solo recibe la compra:
     * el importe nunca proviene del cliente.
     */
    @Transactional
    public Pago iniciarPago(UUID compraId) {
        Compra compra = compraRepository.findForUpdate(compraId)
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND,
                        URI.create("/problems/compra-no-encontrada"), "Compra no encontrada",
                        "No existe una compra con el identificador indicado."));

        if (pagoRepository.existsByCompraIdAndEstadoIn(compra.getId(), ACTIVOS)) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/pago-en-curso"),
                    "Pago en curso", "La compra ya tiene un pago pendiente o aprobado.");
        }
        // INT2-77: un rechazo libera las reservas, así que la compra queda cerrada.
        if (!compra.estaPendienteDePago()) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/compra-cerrada"),
                    "Compra cerrada", "La compra está " + compra.getEstado() + " y no admite pagos.");
        }
        Instant ahora = clock.instant();
        if (reservaRepository.findByCompraIdAndEstado(compra.getId(), EstadoReserva.ACTIVA).stream()
                .anyMatch(reserva -> reserva.estaVencida(ahora))) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/reserva-vencida"),
                    "Reserva vencida", "La reserva de stock de la compra ya venció.");
        }

        RegistroPasarela registro = pasarela.registrar(new SolicitudPago(compra.getId(), compra.getMontoTotal()));
        return pagoRepository.save(new Pago(compra, pasarela.proveedor(), registro.referencia()));
    }

    /**
     * Aplica el resultado del proveedor y su efecto sobre la compra y sus reservas:
     * aprobado confirma el stock reservado, rechazado lo libera y pendiente lo
     * conserva hasta su vencimiento. Un resultado repetido no tiene efecto ni vuelve
     * a publicar el evento.
     */
    @Transactional
    public Pago registrarResultado(UUID pagoId, EstadoPago resultado, String motivoRechazo) {
        Pago pago = buscarPago(pagoId);
        Compra compra = compraRepository.findForUpdate(pago.getCompra().getId()).orElseThrow();
        List<Reserva> activas = reservaRepository.findByCompraIdAndEstado(compra.getId(), EstadoReserva.ACTIVA);

        // Aprobar con la reserva ya vencida dejaría un pago sin stock: se rechaza.
        Instant ahora = clock.instant();
        if (resultado == EstadoPago.APROBADO && pago.getEstado() == EstadoPago.PENDIENTE
                && activas.stream().anyMatch(reserva -> reserva.estaVencida(ahora))) {
            return aplicar(pago, compra, activas, EstadoPago.RECHAZADO, MOTIVO_RESERVA_VENCIDA, EstadoCompra.EXPIRADA);
        }
        return aplicar(pago, compra, activas, resultado, motivoRechazo, EstadoCompra.RECHAZADA);
    }

    /** Rechaza un pago pendiente cuyas reservas vencieron; la compra queda EXPIRADA. */
    @Transactional
    public Pago expirar(UUID pagoId) {
        Pago pago = buscarPago(pagoId);
        Compra compra = compraRepository.findForUpdate(pago.getCompra().getId()).orElseThrow();
        List<Reserva> activas = reservaRepository.findByCompraIdAndEstado(compra.getId(), EstadoReserva.ACTIVA);
        return aplicar(pago, compra, activas, EstadoPago.RECHAZADO, MOTIVO_RESERVA_VENCIDA, EstadoCompra.EXPIRADA);
    }

    private Pago aplicar(Pago pago, Compra compra, List<Reserva> activas, EstadoPago resultado,
            String motivoRechazo, EstadoCompra destinoSiRechaza) {
        boolean cambio;
        try {
            cambio = pago.aplicarResultado(resultado, motivoRechazo);
        } catch (TransicionPagoInvalidaException exception) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/transicion-pago-invalida"),
                    "Transición de pago inválida",
                    "Un pago " + exception.getOrigen() + " no puede pasar a " + exception.getDestino() + ".");
        }
        if (!cambio || !pago.getEstado().esFinal()) {
            return pago;
        }

        if (pago.getEstado() == EstadoPago.APROBADO) {
            activas.forEach(Reserva::confirmar);
            compra.cerrar(EstadoCompra.PAGADA);
        } else {
            activas.forEach(Reserva::liberar);
            compra.cerrar(destinoSiRechaza);
        }
        eventos.publishEvent(new PagoFinalizado(UUID.randomUUID(), traceIds.actual(), pago.getId(), compra.getId(),
                compra.getUsuarioId(), pago.getEstado(), pago.getMonto(), pago.getMotivoRechazo(),
                activas.stream().map(reserva -> new PagoFinalizado.Item(reserva.getOfertaId(), reserva.getCantidad()))
                        .toList()));
        return pago;
    }

    private Pago buscarPago(UUID pagoId) {
        return pagoRepository.findById(pagoId)
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND,
                        URI.create("/problems/pago-no-encontrado"), "Pago no encontrado",
                        "No existe un pago con el identificador indicado."));
    }
}
