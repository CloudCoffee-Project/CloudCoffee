package cl.cloudcoffee.order_service.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.amqp.AmqpConnectException;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.order_service.messaging.CloudCoffeeEvent;
import cl.cloudcoffee.order_service.messaging.PagoEventPublisher;
import cl.cloudcoffee.order_service.messaging.RabbitTopologyConfig;
import cl.cloudcoffee.order_service.model.Compra;
import cl.cloudcoffee.order_service.model.EstadoCompra;
import cl.cloudcoffee.order_service.model.EstadoPago;
import cl.cloudcoffee.order_service.model.EstadoReserva;
import cl.cloudcoffee.order_service.model.Pago;
import cl.cloudcoffee.order_service.model.Reserva;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.order_service.repository.PagoRepository;
import cl.cloudcoffee.order_service.repository.ReservaRepository;
import cl.cloudcoffee.security.testing.JwtTestSupport;

/** INT2-77: el resultado del pago mantiene coherentes pago, compra y reservas, y se publica. */
@SpringBootTest(properties = "management.tracing.enabled=false")
class ResultadoPagoIntegrationTests extends JwtTestSupport {

    static final UUID AMERICANO = UUID.randomUUID();
    static final UUID MEDIALUNA = UUID.randomUUID();

    @Autowired PagoService pagoService;
    @Autowired ReservaService reservaService;
    @Autowired ExpiracionReservasService expiracion;
    @Autowired CompraRepository compras;
    @Autowired PagoRepository pagos;
    @Autowired ReservaRepository reservas;

    @MockitoBean RabbitTemplate rabbit;
    @MockitoBean Clock clock;

    Instant ahora = Instant.parse("2026-10-20T15:00:00Z");

    @BeforeEach
    void relojFijo() {
        when(clock.instant()).thenAnswer(invocation -> ahora);
    }

    @Test
    void aprobacionConfirmaLasReservasPagaLaCompraYPublicaElResultado() {
        Compra compra = compraConReservas();
        Pago pago = pagoService.iniciarPago(compra.getId());

        pagoService.registrarResultado(pago.getId(), EstadoPago.APROBADO, null);

        assertThat(estadoCompra(compra)).isEqualTo(EstadoCompra.PAGADA);
        assertThat(estadosReservas(compra)).containsOnly(EstadoReserva.CONFIRMADA);
        CloudCoffeeEvent evento = unicoEvento(PagoEventPublisher.PAGO_APROBADO_EVENT);
        assertThat(evento.eventId()).isNotNull();
        assertThat(evento.traceId()).isNotBlank();
        assertThat(evento.payload())
                .containsEntry("pagoId", pago.getId().toString())
                .containsEntry("compraId", compra.getId().toString())
                .containsEntry("usuarioId", compra.getUsuarioId().toString())
                .containsEntry("estado", "APROBADO")
                .containsEntry("monto", "2400.00");
        assertThat(evento.payload().get("items")).asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.LIST)
                .containsExactlyInAnyOrder(
                        Map.of("ofertaId", AMERICANO.toString(), "cantidad", 1),
                        Map.of("ofertaId", MEDIALUNA.toString(), "cantidad", 1));
    }

    @Test
    void rechazoLiberaLasReservasYPublicaElMotivo() {
        Compra compra = compraConReservas();
        Pago pago = pagoService.iniciarPago(compra.getId());

        pagoService.registrarResultado(pago.getId(), EstadoPago.RECHAZADO, "Fondos insuficientes");

        assertThat(estadoCompra(compra)).isEqualTo(EstadoCompra.RECHAZADA);
        assertThat(estadosReservas(compra)).containsOnly(EstadoReserva.LIBERADA);
        assertThat(unicoEvento(PagoEventPublisher.PAGO_RECHAZADO_EVENT).payload())
                .containsEntry("estado", "RECHAZADO")
                .containsEntry("motivoRechazo", "Fondos insuficientes");
    }

    @Test
    void pendienteConservaLasReservasHastaSuVencimiento() {
        Compra compra = compraConReservas();
        Pago pago = pagoService.iniciarPago(compra.getId());

        // Un minuto antes de vencer no se toca nada.
        ahora = ahora.plus(reservaService.getVigencia()).minusSeconds(60);
        assertThat(expiracion.comprasVencidas()).doesNotContain(compra.getId());
        assertThat(expiracion.expirarCompra(compra.getId())).isFalse();
        assertThat(estadosReservas(compra)).containsOnly(EstadoReserva.ACTIVA);
        assertThat(estadoCompra(compra)).isEqualTo(EstadoCompra.PENDIENTE_PAGO);
        verify(rabbit, never()).convertAndSend(anyString(), anyString(), any(Object.class));

        // Al vencer, el pago pendiente se rechaza y el stock se libera.
        ahora = ahora.plusSeconds(60);
        assertThat(expiracion.comprasVencidas()).contains(compra.getId());
        assertThat(expiracion.expirarCompra(compra.getId())).isTrue();

        Pago expirado = pagos.findById(pago.getId()).orElseThrow();
        assertThat(expirado.getEstado()).isEqualTo(EstadoPago.RECHAZADO);
        assertThat(expirado.getMotivoRechazo()).isEqualTo(PagoService.MOTIVO_RESERVA_VENCIDA);
        assertThat(estadoCompra(compra)).isEqualTo(EstadoCompra.EXPIRADA);
        assertThat(estadosReservas(compra)).containsOnly(EstadoReserva.LIBERADA);
        assertThat(unicoEvento(PagoEventPublisher.PAGO_RECHAZADO_EVENT).payload())
                .containsEntry("motivoRechazo", PagoService.MOTIVO_RESERVA_VENCIDA);
    }

    @Test
    void aprobacionQueLlegaConLaReservaVencidaSeRechaza() {
        Compra compra = compraConReservas();
        Pago pago = pagoService.iniciarPago(compra.getId());
        ahora = ahora.plus(reservaService.getVigencia());

        Pago resultado = pagoService.registrarResultado(pago.getId(), EstadoPago.APROBADO, null);

        assertThat(resultado.getEstado()).isEqualTo(EstadoPago.RECHAZADO);
        assertThat(estadoCompra(compra)).isEqualTo(EstadoCompra.EXPIRADA);
        assertThat(estadosReservas(compra)).containsOnly(EstadoReserva.LIBERADA);
        unicoEvento(PagoEventPublisher.PAGO_RECHAZADO_EVENT);
    }

    @Test
    void compraSinPagoQueVenceLiberaSuStockSinPublicar() {
        Compra compra = compraConReservas();
        ahora = ahora.plus(reservaService.getVigencia());

        assertThat(expiracion.expirarCompra(compra.getId())).isTrue();

        assertThat(estadoCompra(compra)).isEqualTo(EstadoCompra.EXPIRADA);
        assertThat(estadosReservas(compra)).containsOnly(EstadoReserva.LIBERADA);
        verify(rabbit, never()).convertAndSend(anyString(), anyString(), any(Object.class));
        assertConflicto(() -> pagoService.iniciarPago(compra.getId()));
    }

    @Test
    void resultadoRepetidoNoReaplicaNiVuelveAPublicar() {
        Compra compra = compraConReservas();
        Pago pago = pagoService.iniciarPago(compra.getId());
        pagoService.registrarResultado(pago.getId(), EstadoPago.APROBADO, null);

        pagoService.registrarResultado(pago.getId(), EstadoPago.APROBADO, null);
        pagoService.registrarResultado(pago.getId(), EstadoPago.APROBADO, null);

        assertThat(estadoCompra(compra)).isEqualTo(EstadoCompra.PAGADA);
        assertThat(estadosReservas(compra)).containsOnly(EstadoReserva.CONFIRMADA);
        unicoEvento(PagoEventPublisher.PAGO_APROBADO_EVENT);
    }

    @Test
    void transicionInvalidaResponde409SinTocarReservasNiPublicar() {
        Compra compra = compraConReservas();
        Pago pago = pagoService.iniciarPago(compra.getId());
        pagoService.registrarResultado(pago.getId(), EstadoPago.APROBADO, null);

        assertConflicto(() -> pagoService.registrarResultado(pago.getId(), EstadoPago.RECHAZADO, "tarde"));
        assertConflicto(() -> pagoService.registrarResultado(pago.getId(), EstadoPago.PENDIENTE, null));

        assertThat(pagos.findById(pago.getId()).orElseThrow().getEstado()).isEqualTo(EstadoPago.APROBADO);
        assertThat(estadoCompra(compra)).isEqualTo(EstadoCompra.PAGADA);
        assertThat(estadosReservas(compra)).containsOnly(EstadoReserva.CONFIRMADA);
        unicoEvento(PagoEventPublisher.PAGO_APROBADO_EVENT);
    }

    @Test
    void cadaResultadoTieneSuPropioEventId() {
        Pago aprobado = pagoService.iniciarPago(compraConReservas().getId());
        Pago rechazado = pagoService.iniciarPago(compraConReservas().getId());

        pagoService.registrarResultado(aprobado.getId(), EstadoPago.APROBADO, null);
        pagoService.registrarResultado(rechazado.getId(), EstadoPago.RECHAZADO, "x");

        ArgumentCaptor<CloudCoffeeEvent> eventos = ArgumentCaptor.forClass(CloudCoffeeEvent.class);
        verify(rabbit, times(2)).convertAndSend(eq(RabbitTopologyConfig.EVENTS_EXCHANGE), anyString(), eventos.capture());
        assertThat(eventos.getAllValues()).extracting(CloudCoffeeEvent::eventId).doesNotHaveDuplicates();
    }

    @Test
    void siRabbitNoEstaDisponibleElResultadoIgualQuedaGuardado() {
        doThrow(new AmqpConnectException(new java.net.ConnectException("sin broker")))
                .when(rabbit).convertAndSend(anyString(), anyString(), any(Object.class));
        Compra compra = compraConReservas();
        Pago pago = pagoService.iniciarPago(compra.getId());

        pagoService.registrarResultado(pago.getId(), EstadoPago.APROBADO, null);

        assertThat(estadoCompra(compra)).isEqualTo(EstadoCompra.PAGADA);
        assertThat(estadosReservas(compra)).containsOnly(EstadoReserva.CONFIRMADA);
    }

    private Compra compraConReservas() {
        Compra compra = compras.saveAndFlush(new Compra(UUID.randomUUID(), new BigDecimal("2400.00")));
        reservaService.reservar(compra, AMERICANO, 1);
        reservaService.reservar(compra, MEDIALUNA, 1);
        return compra;
    }

    private EstadoCompra estadoCompra(Compra compra) {
        return compras.findById(compra.getId()).orElseThrow().getEstado();
    }

    private List<EstadoReserva> estadosReservas(Compra compra) {
        return reservas.findByCompraIdOrderByCreatedAtAsc(compra.getId()).stream().map(Reserva::getEstado).toList();
    }

    private CloudCoffeeEvent unicoEvento(String tipo) {
        ArgumentCaptor<CloudCoffeeEvent> evento = ArgumentCaptor.forClass(CloudCoffeeEvent.class);
        verify(rabbit, times(1)).convertAndSend(eq(RabbitTopologyConfig.EVENTS_EXCHANGE), eq(tipo), evento.capture());
        assertThat(evento.getValue().eventType()).isEqualTo(tipo);
        return evento.getValue();
    }

    private static void assertConflicto(org.assertj.core.api.ThrowableAssert.ThrowingCallable accion) {
        assertThatThrownBy(accion).isInstanceOfSatisfying(BusinessException.class,
                error -> assertThat(error.getStatus()).isEqualTo(HttpStatus.CONFLICT));
    }
}
