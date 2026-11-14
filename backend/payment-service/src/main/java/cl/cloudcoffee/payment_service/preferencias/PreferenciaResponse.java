package cl.cloudcoffee.payment_service.preferencias;

import java.time.Instant;
import java.util.UUID;

/** Contrato Preferencia 2.0.0. preferenciaId/initPoint son null mientras la creación no esté confirmada. */
public record PreferenciaResponse(UUID paymentId, UUID compraId, UUID clienteId, String preferenciaId,
        String referenciaExterna, String estado, long montoTotal, String moneda, String entorno, String initPoint,
        Instant expiraAt, long version) {

    static PreferenciaResponse from(IntencionRepository.Intencion intencion) {
        return new PreferenciaResponse(intencion.id(), intencion.compraId(), intencion.clienteId(),
                intencion.preferenciaId(), intencion.referenciaExterna(), estado(intencion.estado()), intencion.monto(),
                "CLP", "sandbox", intencion.initPoint(), intencion.expiraAt(), Math.max(1, intencion.version()));
    }

    /** Estado público del contrato (también el {@code estado} del evento payment.pago.resultado.v1). */
    public static String estado(String interno) {
        return switch (interno) {
            case "CREATING", "PENDING" -> "pendiente";
            case "APPROVED" -> "aprobado";
            case "REJECTED" -> "rechazado";
            case "CANCELLED" -> "cancelado";
            case "EXPIRED" -> "vencido";
            default -> "requiere_conciliacion";
        };
    }
}
