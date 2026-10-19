package cl.cloudcoffee.order_service.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;

import java.math.BigDecimal;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.order_service.model.Compra;
import cl.cloudcoffee.order_service.model.EstadoPago;
import cl.cloudcoffee.order_service.model.Pago;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago.SolicitudPago;
import cl.cloudcoffee.order_service.pasarela.PasarelaPagoSimulada;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.order_service.repository.PagoRepository;
import cl.cloudcoffee.security.testing.JwtTestSupport;

/** INT2-53: persistencia de pagos simulados contra la base migrada por Flyway. */
@SpringBootTest(properties = "management.tracing.enabled=false")
class PagoServiceIntegrationTests extends JwtTestSupport {

    @Autowired PagoService pagoService;
    @Autowired CompraRepository compras;
    @Autowired PagoRepository pagos;

    @MockitoSpyBean
    PasarelaPago pasarela;

    @Test
    void iniciarPagoGuardaPendienteConElMontoDeLaCompraYReferenciaDelProveedor() {
        Compra compra = compra("3700.00");

        Pago pago = pagoService.iniciarPago(compra.getId());

        Pago guardado = pagos.findById(pago.getId()).orElseThrow();
        assertThat(guardado.getEstado()).isEqualTo(EstadoPago.PENDIENTE);
        assertThat(guardado.getMonto()).isEqualByComparingTo("3700.00");
        assertThat(guardado.getProveedor()).isEqualTo(PasarelaPagoSimulada.PROVEEDOR);
        assertThat(guardado.getReferenciaProveedor()).startsWith("SIM-");
        // El proveedor recibe el importe calculado en el servidor, no uno externo.
        verify(pasarela).registrar(new SolicitudPago(compra.getId(), new BigDecimal("3700.00")));
    }

    @Test
    void compraInexistenteResponde404() {
        assertThatThrownBy(() -> pagoService.iniciarPago(UUID.randomUUID()))
                .isInstanceOfSatisfying(BusinessException.class,
                        error -> assertThat(error.getStatus()).isEqualTo(HttpStatus.NOT_FOUND));
    }

    @ParameterizedTest
    @EnumSource(EstadoPago.class)
    void unaCompraAdmiteUnSoloPagoEnCualquierEstado(EstadoPago estado) {
        Compra compra = compra("1500.00");
        Pago primero = pagoService.iniciarPago(compra.getId());
        if (estado.esFinal()) {
            pagoService.registrarResultado(primero.getId(), estado, "motivo");
        }

        assertThatThrownBy(() -> pagoService.iniciarPago(compra.getId()))
                .isInstanceOfSatisfying(BusinessException.class, error -> {
                    assertThat(error.getStatus()).isEqualTo(HttpStatus.CONFLICT);
                    assertThat(error.getType().toString()).isEqualTo("/problems/pago-existente");
                });
        assertThat(pagos.findByCompraId(compra.getId())).get().extracting(Pago::getId, Pago::getEstado)
                .containsExactly(primero.getId(), estado);
    }

    @Test
    void unRechazoEsTerminalYReintentarExigeUnaCompraNueva() {
        // Contrato INT2-50 (#112): el pago no se reemplaza ni se reinicia.
        Compra compra = compra("1500.00");
        Pago rechazado = pagoService.iniciarPago(compra.getId());
        pagoService.registrarResultado(rechazado.getId(), EstadoPago.RECHAZADO, "Tarjeta rechazada");

        assertConflicto(() -> pagoService.iniciarPago(compra.getId()));
        assertConflicto(() -> pagoService.registrarResultado(rechazado.getId(), EstadoPago.APROBADO, null));
        assertThat(pagos.findById(rechazado.getId()).orElseThrow().getEstado()).isEqualTo(EstadoPago.RECHAZADO);

        Compra nueva = compra("1500.00");
        assertThat(pagoService.iniciarPago(nueva.getId()).getEstado()).isEqualTo(EstadoPago.PENDIENTE);
    }

    @Test
    void registrarResultadoPersisteLaTransicion() {
        Pago pago = pagoService.iniciarPago(compra("2000.00").getId());

        pagoService.registrarResultado(pago.getId(), EstadoPago.RECHAZADO, "Fondos insuficientes");

        Pago guardado = pagos.findById(pago.getId()).orElseThrow();
        assertThat(guardado.getEstado()).isEqualTo(EstadoPago.RECHAZADO);
        assertThat(guardado.getMotivoRechazo()).isEqualTo("Fondos insuficientes");
    }

    @Test
    void resultadoRepetidoEsIdempotenteYUnoContradictorioResponde409() {
        Pago pago = pagoService.iniciarPago(compra("2000.00").getId());
        pagoService.registrarResultado(pago.getId(), EstadoPago.APROBADO, null);
        long version = pagos.findById(pago.getId()).orElseThrow().getVersion();

        pagoService.registrarResultado(pago.getId(), EstadoPago.APROBADO, null);
        assertThat(pagos.findById(pago.getId()).orElseThrow().getVersion()).isEqualTo(version);

        assertConflicto(() -> pagoService.registrarResultado(pago.getId(), EstadoPago.RECHAZADO, "tarde"));
        assertConflicto(() -> pagoService.registrarResultado(pago.getId(), EstadoPago.PENDIENTE, null));
        assertThat(pagos.findById(pago.getId()).orElseThrow().getEstado()).isEqualTo(EstadoPago.APROBADO);
    }

    @Test
    void pagoInexistenteResponde404() {
        assertThatThrownBy(() -> pagoService.registrarResultado(UUID.randomUUID(), EstadoPago.APROBADO, null))
                .isInstanceOfSatisfying(BusinessException.class,
                        error -> assertThat(error.getStatus()).isEqualTo(HttpStatus.NOT_FOUND));
    }

    @Test
    void dosResultadosConcurrentesNoSeSobrescriben() {
        Pago pago = pagoService.iniciarPago(compra("2000.00").getId());
        // Dos lecturas del mismo pago, como dos notificaciones del proveedor en paralelo.
        Pago primeraLectura = pagos.findById(pago.getId()).orElseThrow();
        Pago segundaLectura = pagos.findById(pago.getId()).orElseThrow();

        primeraLectura.aplicarResultado(EstadoPago.APROBADO, null);
        pagos.saveAndFlush(primeraLectura);
        segundaLectura.aplicarResultado(EstadoPago.RECHAZADO, "tarde");

        assertThatThrownBy(() -> pagos.saveAndFlush(segundaLectura))
                .isInstanceOf(ObjectOptimisticLockingFailureException.class);
        assertThat(pagos.findById(pago.getId()).orElseThrow().getEstado()).isEqualTo(EstadoPago.APROBADO);
    }

    private Compra compra(String monto) {
        return compras.saveAndFlush(new Compra(UUID.randomUUID(), new BigDecimal(monto)));
    }

    private static void assertConflicto(org.assertj.core.api.ThrowableAssert.ThrowingCallable accion) {
        assertThatThrownBy(accion).isInstanceOfSatisfying(BusinessException.class,
                error -> assertThat(error.getStatus()).isEqualTo(HttpStatus.CONFLICT));
    }
}
