package cl.cloudcoffee.catalog_service.messaging;

import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import cl.cloudcoffee.catalog_service.service.ProductFollowService;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * INT2-129: una cuenta dada de baja deja de seguir productos, sin que Auth lea ni escriba tablas de Catalog.
 * Retirar los seguimientos es idempotente, así que una entrega repetida no necesita deduplicación.
 */
@Component
@ConditionalOnProperty(name = "catalog.cuentas.consumer-enabled", havingValue = "true", matchIfMissing = true)
public class CuentasAnonimizadasConsumer {

    private static final Logger LOG = LoggerFactory.getLogger(CuentasAnonimizadasConsumer.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final ProductFollowService seguimientos;

    public CuentasAnonimizadasConsumer(ProductFollowService seguimientos) {
        this.seguimientos = seguimientos;
    }

    @RabbitListener(queues = CuentasAnonimizadasTopology.COLA)
    public void consumir(Message mensaje) {
        UUID usuarioId;
        try {
            usuarioId = leer(mensaje.getBody());
        } catch (IllegalArgumentException invalido) {
            LOG.error("Evento de baja de cuenta inválido ({}); se envía a la DLQ", invalido.getMessage());
            throw new AmqpRejectAndDontRequeueException("Evento de baja de cuenta inválido", invalido);
        }
        int retirados = seguimientos.retirarSeguimientosDe(usuarioId);
        LOG.info("Cuenta dada de baja: {} seguimientos retirados", retirados);
    }

    /** @throws IllegalArgumentException si el mensaje no es un auth.usuario.anonimizado.v1 con usuarioId UUID. */
    static UUID leer(byte[] cuerpo) {
        JsonNode evento;
        try {
            evento = JSON.readTree(cuerpo);
        } catch (JacksonException error) {
            throw new IllegalArgumentException("El evento no es JSON válido");
        }
        if (evento == null || !CuentasAnonimizadasTopology.USUARIO_ANONIMIZADO.equals(evento.path("eventType").asString(null))) {
            throw new IllegalArgumentException("eventType inesperado");
        }
        JsonNode usuario = evento.path("payload").path("usuarioId");
        try {
            if (usuario.isString()) return UUID.fromString(usuario.asString());
        } catch (IllegalArgumentException error) {
            // Se responde abajo.
        }
        throw new IllegalArgumentException("usuarioId ausente o inválido");
    }
}
