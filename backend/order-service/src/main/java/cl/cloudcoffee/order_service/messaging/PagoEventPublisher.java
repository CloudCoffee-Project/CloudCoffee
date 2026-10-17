package cl.cloudcoffee.order_service.messaging;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.AmqpException;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import cl.cloudcoffee.order_service.model.EstadoPago;

/**
 * INT2-77: publica el resultado del pago en cloudcoffee.events después del commit,
 * para no anunciar cambios que luego se revierten. El eventId lo fija la transacción
 * que produjo el resultado; los consumidores lo usan para no procesarlo dos veces.
 */
@Component
public class PagoEventPublisher {

    public static final String PAGO_APROBADO_EVENT = "order.pago.aprobado.v1";
    public static final String PAGO_RECHAZADO_EVENT = "order.pago.rechazado.v1";

    private static final Logger LOGGER = LoggerFactory.getLogger(PagoEventPublisher.class);

    private final RabbitTemplate rabbitTemplate;

    public PagoEventPublisher(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void publicar(PagoFinalizado resultado) {
        CloudCoffeeEvent event = evento(resultado);
        try {
            rabbitTemplate.convertAndSend(RabbitTopologyConfig.EVENTS_EXCHANGE, event.eventType(), event);
            LOGGER.info("Evento {} publicado: eventId={}, traceId={}, pagoId={}",
                    event.eventType(), event.eventId(), event.traceId(), resultado.pagoId());
        } catch (AmqpException exception) {
            // El resultado ya está confirmado en la base: no se responde 500 al cliente.
            // Garantizar la entrega requiere una tabla outbox (pendiente).
            LOGGER.error("No se pudo publicar {}: eventId={}, traceId={}, pagoId={}",
                    event.eventType(), event.eventId(), event.traceId(), resultado.pagoId(), exception);
        }
    }

    static CloudCoffeeEvent evento(PagoFinalizado resultado) {
        String tipo = resultado.estado() == EstadoPago.APROBADO ? PAGO_APROBADO_EVENT : PAGO_RECHAZADO_EVENT;
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("pagoId", resultado.pagoId().toString());
        payload.put("compraId", resultado.compraId().toString());
        payload.put("usuarioId", resultado.usuarioId().toString());
        payload.put("estado", resultado.estado().name());
        payload.put("monto", resultado.monto().toPlainString());
        if (resultado.motivoRechazo() != null) {
            payload.put("motivoRechazo", resultado.motivoRechazo());
        }
        List<Map<String, Object>> items = resultado.items().stream()
                .map(item -> Map.<String, Object>of("ofertaId", item.ofertaId().toString(), "cantidad", item.cantidad()))
                .toList();
        payload.put("items", items);
        return new CloudCoffeeEvent(resultado.eventId(), Instant.now(), resultado.traceId(), tipo, payload);
    }
}
