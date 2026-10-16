package cl.cloudcoffee.order_service.model;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;

class PagoTest {

    @ParameterizedTest
    @CsvSource({
            "PENDIENTE, PENDIENTE, false",
            "PENDIENTE, APROBADO,  true",
            "PENDIENTE, RECHAZADO, true",
            "APROBADO,  PENDIENTE, false",
            "APROBADO,  APROBADO,  false",
            "APROBADO,  RECHAZADO, false",
            "RECHAZADO, PENDIENTE, false",
            "RECHAZADO, APROBADO,  false",
            "RECHAZADO, RECHAZADO, false"
    })
    void matrizDeTransiciones(EstadoPago origen, EstadoPago destino, boolean permitida) {
        assertThat(origen.puedeTransicionarA(destino)).isEqualTo(permitida);
    }

    @Test
    void nuevoPagoQuedaPendienteConElMontoDeLaCompra() {
        Pago pago = new Pago(compra("4500.00"), "SIMULADO", "SIM-1");

        assertThat(pago.getEstado()).isEqualTo(EstadoPago.PENDIENTE);
        assertThat(pago.getMonto()).isEqualByComparingTo("4500.00");
        assertThat(pago.getProveedor()).isEqualTo("SIMULADO");
    }

    @Test
    void pendientePasaAAprobadoSinMotivo() {
        Pago pago = new Pago(compra("1500.00"), "SIMULADO", "SIM-1");

        assertThat(pago.aplicarResultado(EstadoPago.APROBADO, "ignorado")).isTrue();

        assertThat(pago.getEstado()).isEqualTo(EstadoPago.APROBADO);
        assertThat(pago.getMotivoRechazo()).isNull();
        assertThat(pago.getUpdatedAt()).isNotNull();
    }

    @Test
    void pendientePasaARechazadoConMotivo() {
        Pago pago = new Pago(compra("1500.00"), "SIMULADO", "SIM-1");

        pago.aplicarResultado(EstadoPago.RECHAZADO, "Fondos insuficientes");

        assertThat(pago.getEstado()).isEqualTo(EstadoPago.RECHAZADO);
        assertThat(pago.getMotivoRechazo()).isEqualTo("Fondos insuficientes");
    }

    @ParameterizedTest
    @EnumSource(value = EstadoPago.class, names = {"APROBADO", "RECHAZADO"})
    void repetirElMismoResultadoNoCambiaNada(EstadoPago resultado) {
        Pago pago = new Pago(compra("1500.00"), "SIMULADO", "SIM-1");
        pago.aplicarResultado(resultado, "motivo");
        var actualizado = pago.getUpdatedAt();

        assertThat(pago.aplicarResultado(resultado, "otro motivo")).isFalse();

        assertThat(pago.getEstado()).isEqualTo(resultado);
        assertThat(pago.getUpdatedAt()).isEqualTo(actualizado);
    }

    @Test
    void unPagoFinalNoCambiaAOtroEstado() {
        Pago aprobado = new Pago(compra("1500.00"), "SIMULADO", "SIM-1");
        aprobado.aplicarResultado(EstadoPago.APROBADO, null);

        assertThatThrownBy(() -> aprobado.aplicarResultado(EstadoPago.RECHAZADO, "tarde"))
                .isInstanceOf(TransicionPagoInvalidaException.class);
        assertThatThrownBy(() -> aprobado.aplicarResultado(EstadoPago.PENDIENTE, null))
                .isInstanceOf(TransicionPagoInvalidaException.class);
        assertThat(aprobado.getEstado()).isEqualTo(EstadoPago.APROBADO);
    }

    @Test
    void pendienteNoVuelveAPendiente() {
        Pago pago = new Pago(compra("1500.00"), "SIMULADO", "SIM-1");

        assertThatThrownBy(() -> pago.aplicarResultado(EstadoPago.PENDIENTE, null))
                .isInstanceOf(TransicionPagoInvalidaException.class);
    }

    @Test
    void compraRechazaMontosNoPositivos() {
        assertThatIllegalArgumentException().isThrownBy(() -> compra("0.00"));
        assertThatIllegalArgumentException().isThrownBy(() -> compra("-1.00"));
        assertThatIllegalArgumentException().isThrownBy(() -> new Compra(UUID.randomUUID(), null));
    }

    private static Compra compra(String monto) {
        return new Compra(UUID.randomUUID(), new BigDecimal(monto));
    }
}
