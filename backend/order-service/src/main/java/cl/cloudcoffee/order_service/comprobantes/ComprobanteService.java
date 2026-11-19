package cl.cloudcoffee.order_service.comprobantes;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.order_service.model.EstadoCompra;
import cl.cloudcoffee.order_service.model.EstadoOrden;
import cl.cloudcoffee.order_service.model.EstadoPago;
import cl.cloudcoffee.order_service.repository.OrdenRepository;
import cl.cloudcoffee.order_service.repository.PagoRepository;
import java.net.URI;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ComprobanteService {
    private final OrdenRepository ordenes;
    private final PagoRepository pagos;
    private final ComprobantePdf pdf;
    public ComprobanteService(OrdenRepository ordenes, PagoRepository pagos, ComprobantePdf pdf) {
        this.ordenes = ordenes; this.pagos = pagos; this.pdf = pdf;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public byte[] descargar(UUID propietario, UUID ordenId) {
        var orden = ordenes.findConItemsByIdAndPropietario(ordenId, propietario).orElseThrow(() ->
                new BusinessException(HttpStatus.NOT_FOUND, URI.create("/problems/orden-no-encontrada"),
                        "Orden no encontrada", "No existe una orden con el identificador indicado.", "ORDEN_NO_ENCONTRADA"));
        var pago = pagos.findByCompraId(orden.getCompra().getId()).orElse(null);
        if (pago == null || pago.getEstado() != EstadoPago.APROBADO
                || orden.getCompra().getEstado() != EstadoCompra.PAGADO
                || orden.getEstado() == EstadoOrden.PENDIENTE_PAGO
                || orden.getEstado() == EstadoOrden.REVISION_REQUERIDA || orden.getEstado() == EstadoOrden.CANCELADO) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/comprobante-no-disponible"),
                    "Comprobante no disponible", "La orden requiere un pago confirmado.", "COMPROBANTE_NO_DISPONIBLE");
        }
        return pdf.generar(orden);
    }

    /** Identidad determinista, sin secuencia nueva al descargar ni datos personales. */
    public static String folio(UUID ordenId) { return "CC-" + ordenId; }
    public static String nombre(UUID ordenId) { return "comprobante-" + folio(ordenId) + ".pdf"; }
}
