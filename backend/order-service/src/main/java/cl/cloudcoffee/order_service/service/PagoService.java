package cl.cloudcoffee.order_service.service;

import java.net.URI;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.order_service.model.Compra;
import cl.cloudcoffee.order_service.model.EstadoPago;
import cl.cloudcoffee.order_service.model.MotivoPago;
import cl.cloudcoffee.order_service.model.Pago;
import cl.cloudcoffee.order_service.model.TransicionPagoInvalidaException;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago.RegistroPasarela;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago.SolicitudPago;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.order_service.repository.PagoRepository;

@Service
public class PagoService {

    private final CompraRepository compraRepository;
    private final PagoRepository pagoRepository;
    private final PasarelaPago pasarela;

    public PagoService(CompraRepository compraRepository, PagoRepository pagoRepository, PasarelaPago pasarela) {
        this.compraRepository = compraRepository;
        this.pagoRepository = pagoRepository;
        this.pasarela = pasarela;
    }

    /**
     * Abre el único pago de la compra, PENDIENTE y por su monto total. Solo recibe la
     * compra: el importe nunca proviene del cliente. Contrato INT2-50: el pago no se
     * reemplaza ni se reinicia; tras un rechazo hay que crear una compra nueva.
     */
    @Transactional
    public Pago iniciarPago(UUID compraId) {
        return iniciarPago(compraId, null);
    }

    /**
     * Igual que {@link #iniciarPago(UUID)}, fijando el motivo antes de guardar para que
     * el pago se inserte de una vez (sin un UPDATE que incremente su versión).
     */
    @Transactional
    public Pago iniciarPago(UUID compraId, MotivoPago motivo) {
        Compra compra = compraRepository.findForUpdate(compraId)
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND,
                        URI.create("/problems/compra-no-encontrada"), "Compra no encontrada",
                        "No existe una compra con el identificador indicado."));

        // El bloqueo de la compra serializa inicios concurrentes; UNIQUE (compra_id) lo respalda.
        if (pagoRepository.existsByCompraId(compra.getId())) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/pago-existente"),
                    "La compra ya tiene un pago",
                    "Una compra admite un solo pago; para volver a intentarlo crea una compra nueva.");
        }

        RegistroPasarela registro = pasarela.registrar(new SolicitudPago(compra.getId(), compra.getMontoTotal()));
        Pago pago = new Pago(compra, pasarela.proveedor(), registro.referencia());
        if (motivo != null) {
            pago.registrarMotivo(motivo);
        }
        return pagoRepository.save(pago);
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
