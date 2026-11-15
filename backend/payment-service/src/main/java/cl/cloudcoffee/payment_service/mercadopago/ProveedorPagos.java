package cl.cloudcoffee.payment_service.mercadopago;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * Puerto de consulta de pagos del proveedor (INT2-112). Una notificación solo dice "mira el pago X": el estado,
 * el monto y la referencia siempre se leen del recurso actual consultado con la credencial del backend.
 */
public interface ProveedorPagos {

    /** GET del pago por su ID externo. */
    Consulta consultar(String pagoId);

    /** Todos los pagos asociados a la referencia externa de una intención (para notificaciones perdidas). */
    Busqueda buscarPorReferencia(String referenciaExterna);

    sealed interface Consulta permits Encontrado, NoEncontrado, Fallida {
    }

    sealed interface Busqueda permits Pagos, Fallida {
    }

    record Encontrado(PagoProveedor pago) implements Consulta {
    }

    /** El proveedor respondió 404: aún no propagado, de otra cuenta o una notificación de prueba. */
    record NoEncontrado() implements Consulta {
    }

    record Pagos(List<PagoProveedor> pagos) implements Busqueda {
    }

    /** Proveedor caído, timeout o respuesta ilegible: se reintenta más tarde, nunca se asume un resultado. */
    record Fallida(String motivo) implements Consulta, Busqueda {
    }

    /**
     * Campos saneados del pago. {@code monto} es el transaction_amount tal cual (puede traer decimales);
     * {@code liveMode} es null si el proveedor no lo informó. {@code evidencia} es JSON sin datos del pagador.
     */
    record PagoProveedor(String id, String estado, String detalle, String referenciaExterna, BigDecimal monto,
            String moneda, Boolean liveMode, Instant aprobadoAt, Instant actualizadoAt, String evidencia) {
    }
}
