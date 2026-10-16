package cl.cloudcoffee.order_service.service;

import java.net.URI;
import java.util.EnumSet;
import java.util.Set;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.order_service.model.Compra;
import cl.cloudcoffee.order_service.model.EstadoPago;
import cl.cloudcoffee.order_service.model.Pago;
import cl.cloudcoffee.order_service.model.TransicionPagoInvalidaException;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago.RegistroPasarela;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago.SolicitudPago;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.order_service.repository.PagoRepository;

@Service
public class PagoService {

    private static final Set<EstadoPago> ACTIVOS = EnumSet.of(EstadoPago.PENDIENTE, EstadoPago.APROBADO);

    private final CompraRepository compraRepository;
    private final PagoRepository pagoRepository;
    private final PasarelaPago pasarela;

    public PagoService(CompraRepository compraRepository, PagoRepository pagoRepository, PasarelaPago pasarela) {
        this.compraRepository = compraRepository;
        this.pagoRepository = pagoRepository;
        this.pasarela = pasarela;
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

        RegistroPasarela registro = pasarela.registrar(new SolicitudPago(compra.getId(), compra.getMontoTotal()));
        return pagoRepository.save(new Pago(compra, pasarela.proveedor(), registro.referencia()));
    }

    /** Aplica el resultado del proveedor respetando las transiciones válidas. */
    @Transactional
    public Pago registrarResultado(UUID pagoId, EstadoPago resultado, String motivoRechazo) {
        Pago pago = pagoRepository.findById(pagoId)
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND,
                        URI.create("/problems/pago-no-encontrado"), "Pago no encontrado",
                        "No existe un pago con el identificador indicado."));
        try {
            pago.aplicarResultado(resultado, motivoRechazo);
        } catch (TransicionPagoInvalidaException exception) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/transicion-pago-invalida"),
                    "Transición de pago inválida",
                    "Un pago " + exception.getOrigen() + " no puede pasar a " + exception.getDestino() + ".");
        }
        return pago;
    }
}
