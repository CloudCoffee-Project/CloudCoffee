package cl.cloudcoffee.order_service.service;

import java.net.URI;
import java.util.Optional;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.order_service.model.ComandoPagoSimulado;
import cl.cloudcoffee.order_service.model.Compra;
import cl.cloudcoffee.order_service.model.EscenarioPago;
import cl.cloudcoffee.order_service.model.EstadoPago;
import cl.cloudcoffee.order_service.model.Pago;
import cl.cloudcoffee.order_service.repository.ComandoPagoSimuladoRepository;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.order_service.repository.PagoRepository;

/**
 * INT2-76: ejecuta escenarios de pago deterministas sin proveedor externo, sin datos
 * de tarjeta, sin redirección (initPoint) y sin webhooks. Solo el dueño de la compra
 * puede simular o consultar su pago.
 */
@Service
public class SimulacionPagoService {

    private final CompraRepository compraRepository;
    private final PagoRepository pagoRepository;
    private final ComandoPagoSimuladoRepository comandoRepository;
    private final PagoService pagoService;

    public SimulacionPagoService(CompraRepository compraRepository, PagoRepository pagoRepository,
            ComandoPagoSimuladoRepository comandoRepository, PagoService pagoService) {
        this.compraRepository = compraRepository;
        this.pagoRepository = pagoRepository;
        this.comandoRepository = comandoRepository;
        this.pagoService = pagoService;
    }

    public record ResultadoSimulacion(Pago pago, boolean creado) {
    }

    /**
     * Repetir la misma clave devuelve el pago ya afectado sin volver a ejecutar nada.
     * Un pago PENDIENTE se resuelve en el mismo registro; solo se crea un intento
     * nuevo si la compra no tiene pagos o el último fue rechazado.
     */
    @Transactional
    public ResultadoSimulacion simular(UUID usuarioId, UUID compraId, String clave, EscenarioPago escenario) {
        // El bloqueo de la compra serializa comandos concurrentes con la misma clave.
        Compra compra = compraDelPropietario(compraRepository.findForUpdate(compraId), usuarioId);

        Optional<ComandoPagoSimulado> previo = comandoRepository.findByCompraIdAndClave(compra.getId(), clave);
        if (previo.isPresent()) {
            if (previo.get().getEscenario() != escenario) {
                throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/clave-idempotencia-reutilizada"),
                        "Clave de idempotencia reutilizada",
                        "La clave ya se usó para esta compra con otro escenario.");
            }
            return new ResultadoSimulacion(previo.get().getPago(), false);
        }

        Optional<Pago> pendiente = pagoRepository.findFirstByCompraIdAndEstado(compra.getId(), EstadoPago.PENDIENTE);
        Pago pago = pendiente.orElseGet(() -> pagoService.iniciarPago(compra.getId()));
        if (escenario != EscenarioPago.PENDIENTE) {
            pagoService.registrarResultado(pago.getId(), escenario.estadoResultante(),
                    escenario == EscenarioPago.RECHAZADO ? EscenarioPago.MOTIVO_RECHAZO : null);
        }
        comandoRepository.save(new ComandoPagoSimulado(compra.getId(), clave, pago, escenario));
        return new ResultadoSimulacion(pago, pendiente.isEmpty());
    }

    /** Último intento de pago de la compra. */
    @Transactional(readOnly = true)
    public Pago consultar(UUID usuarioId, UUID compraId) {
        Compra compra = compraDelPropietario(compraRepository.findById(compraId), usuarioId);
        return pagoRepository.findFirstByCompraIdOrderByCreatedAtDesc(compra.getId())
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND,
                        URI.create("/problems/pago-no-encontrado"), "Pago no encontrado",
                        "La compra todavía no tiene pagos."));
    }

    // Una compra ajena responde igual que una inexistente: no revela que existe.
    private static Compra compraDelPropietario(Optional<Compra> compra, UUID usuarioId) {
        return compra.filter(encontrada -> encontrada.getUsuarioId().equals(usuarioId))
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND,
                        URI.create("/problems/compra-no-encontrada"), "Compra no encontrada",
                        "No existe una compra con el identificador indicado."));
    }
}
