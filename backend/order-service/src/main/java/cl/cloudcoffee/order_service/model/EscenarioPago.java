package cl.cloudcoffee.order_service.model;

import java.util.Arrays;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Escenario de la simulación (contrato INT2-50): el mismo escenario produce siempre
 * el mismo estado y motivo. En JSON se escribe {@code aprobar}, {@code rechazar} o
 * {@code pendiente}.
 */
public enum EscenarioPago {
    APROBAR("aprobar", EstadoPago.APROBADO, MotivoPago.APROBACION_SIMULADA),
    RECHAZAR("rechazar", EstadoPago.RECHAZADO, MotivoPago.RECHAZO_SIMULADO),
    PENDIENTE("pendiente", EstadoPago.PENDIENTE, MotivoPago.ESCENARIO_PENDIENTE);

    private final String codigo;
    private final EstadoPago estado;
    private final MotivoPago motivo;

    EscenarioPago(String codigo, EstadoPago estado, MotivoPago motivo) {
        this.codigo = codigo;
        this.estado = estado;
        this.motivo = motivo;
    }

    @JsonValue
    public String codigo() {
        return codigo;
    }

    public EstadoPago estado() {
        return estado;
    }

    public MotivoPago motivo() {
        return motivo;
    }

    /** Solo acepta los códigos exactos del contrato; cualquier otro valor es un 400. */
    @JsonCreator
    public static EscenarioPago desdeCodigo(String codigo) {
        return Arrays.stream(values()).filter(escenario -> escenario.codigo.equals(codigo)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Escenario desconocido: " + codigo));
    }
}
