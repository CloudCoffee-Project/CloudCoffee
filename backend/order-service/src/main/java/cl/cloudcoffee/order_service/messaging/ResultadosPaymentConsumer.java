package cl.cloudcoffee.order_service.messaging;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import cl.cloudcoffee.order_service.service.ResultadoExternoService;
import cl.cloudcoffee.order_service.service.ResultadoExternoService.ResultadoInconsistente;

/**
 * Consumidor de {@code payment.pago.resultado.v1}. La deduplicación por eventId y el control por versión están
 * en {@link ResultadoExternoService}. Un evento inválido o inconsistente va directo a la DLQ; un fallo
 * transitorio (base de datos) se reintenta según {@code spring.rabbitmq.listener.simple.retry} y luego va a la
 * DLQ, sin perder el resultado: la conciliación periódica vuelve a consultarlo en Payment.
 */
@Component
@ConditionalOnProperty(name = "cloudcoffee.pagos.consumer-enabled", havingValue = "true", matchIfMissing = true)
public class ResultadosPaymentConsumer {

    private static final Logger LOG = LoggerFactory.getLogger(ResultadosPaymentConsumer.class);

    private final ResultadoExternoService resultados;

    public ResultadosPaymentConsumer(ResultadoExternoService resultados) {
        this.resultados = resultados;
    }

    @RabbitListener(queues = PaymentResultadosTopology.COLA)
    public void consumir(Message mensaje) {
        ResultadoExternoService.ResultadoExterno resultado;
        try {
            resultado = EventoResultadoPayment.leer(mensaje.getBody());
        } catch (IllegalArgumentException invalido) {
            LOG.error("Evento de Payment inválido ({}); se envía a la DLQ", invalido.getMessage());
            throw new AmqpRejectAndDontRequeueException("Evento de Payment inválido", invalido);
        }
        try {
            var efecto = resultados.aplicar(resultado);
            LOG.info("Resultado de Payment {} (compra {}, v{}): {}", resultado.eventId(), resultado.compraId(),
                    resultado.version(), efecto);
        } catch (ResultadoInconsistente inconsistente) {
            LOG.error("Resultado de Payment {} inconsistente: {}", resultado.eventId(), inconsistente.getMessage());
            throw new AmqpRejectAndDontRequeueException("Resultado de Payment inconsistente", inconsistente);
        }
    }
}
