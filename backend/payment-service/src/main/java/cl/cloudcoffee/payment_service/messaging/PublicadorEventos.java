package cl.cloudcoffee.payment_service.messaging;

import java.time.Clock;
import java.time.Instant;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import cl.cloudcoffee.payment_service.config.ProcesamientoProperties;
import cl.cloudcoffee.payment_service.messaging.CanalEventos.Envio;
import cl.cloudcoffee.payment_service.pagos.PagosRepository;
import cl.cloudcoffee.payment_service.pagos.PagosRepository.EventoPendiente;

/**
 * Publicador del outbox (al menos una vez). Siempre reenvía el mismo eventId; el consumidor deduplica.
 *
 * <p>Un fallo (broker caído, sin confirmación, rechazo o sin ruta) reprograma con backoff. Agotados los
 * intentos, el evento se copia a {@code payment.events.dlq} y la fila queda DEAD como evidencia; si ni siquiera
 * la DLQ confirma (broker caído), sigue PENDING y se reintenta: un broker caído nunca pierde el hecho de pago.
 */
@Service
public class PublicadorEventos {

    private static final Logger log = LoggerFactory.getLogger(PublicadorEventos.class);
    private static final int LOTE = 20;

    private final PagosRepository repo;
    private final CanalEventos canal;
    private final ProcesamientoProperties config;
    private final Clock clock;

    public PublicadorEventos(PagosRepository repo, CanalEventos canal, ProcesamientoProperties config, Clock clock) {
        this.repo = repo;
        this.canal = canal;
        this.config = config;
        this.clock = clock;
    }

    /** Publica hasta un lote de eventos pendientes. Devuelve cuántos tomó. */
    public int publicarPendientes() {
        int tomados = 0;
        Instant ahora = clock.instant();
        for (EventoPendiente evento : repo.outboxPendientes(ahora, LOTE)) {
            if (!repo.reclamarOutbox(evento.eventId(), evento.intentos(), ahora, ahora.plus(config.lease()))) continue;
            tomados++;
            int intento = evento.intentos() + 1;
            Envio envio = canal.enviar(evento.exchange(), evento.routingKey(), evento.eventId(), evento.payload(), null);
            Instant despues = clock.instant();
            if (envio.confirmado()) {
                repo.outboxPublicado(evento.eventId(), despues);
            } else if (intento < config.maxAttempts()) {
                repo.outboxReprogramar(evento.eventId(), envio.codigo(), despues.plus(config.backoff(intento)), despues);
            } else {
                aDeadLetter(evento, envio.codigo(), intento, despues);
            }
        }
        return tomados;
    }

    private void aDeadLetter(EventoPendiente evento, String codigo, int intento, Instant ahora) {
        Envio dlq = canal.enviar(PaymentMessagingConfiguration.DEAD_LETTER_EXCHANGE, PaymentMessagingConfiguration.PAYMENT_DLQ,
                evento.eventId(), evento.payload(), codigo);
        if (dlq.confirmado()) {
            log.error("El evento {} agotó {} intentos ({}); enviado a {}", evento.eventId(), intento, codigo,
                    PaymentMessagingConfiguration.PAYMENT_DLQ);
            repo.outboxMuerto(evento.eventId(), codigo, ahora);
        } else {
            log.warn("El evento {} agotó sus intentos y la DLQ tampoco confirmó ({}); se reintentará", evento.eventId(),
                    dlq.codigo());
            repo.outboxReprogramar(evento.eventId(), codigo, ahora.plus(config.maxBackoff()), ahora);
        }
    }
}
