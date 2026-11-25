package cl.cloudcoffee.catalog_service.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;

import cl.cloudcoffee.catalog_service.service.ProductFollowService;

/** INT2-129: lectura de auth.usuario.anonimizado.v1; un mensaje inválido va a la DLQ sin efectos. */
class CuentasAnonimizadasConsumerTests {

    static final UUID USUARIO = UUID.fromString("10000000-0000-4000-8000-000000000001");

    final ProductFollowService seguimientos = mock(ProductFollowService.class);
    final CuentasAnonimizadasConsumer consumer = new CuentasAnonimizadasConsumer(seguimientos);

    @Test
    void retiresTheFollowsOfTheRemovedAccount() {
        consumer.consumir(mensaje(evento("auth.usuario.anonimizado.v1", "\"" + USUARIO + "\"")));
        verify(seguimientos).retirarSeguimientosDe(USUARIO);
    }

    @Test
    void readsOnlyTheUserIdOfTheContract() {
        assertThat(CuentasAnonimizadasConsumer.leer(evento("auth.usuario.anonimizado.v1", "\"" + USUARIO + "\"")
                .getBytes(StandardCharsets.UTF_8))).isEqualTo(USUARIO);
    }

    @Test
    void invalidMessagesAreRejectedWithoutTouchingFollows() {
        for (String cuerpo : new String[]{"no es json", "[]",
                evento("auth.user.registered.v1", "\"" + USUARIO + "\""),
                evento("auth.usuario.anonimizado.v1", "\"no-es-uuid\""),
                evento("auth.usuario.anonimizado.v1", "123"),
                "{\"eventType\":\"auth.usuario.anonimizado.v1\"}"}) {
            assertThatThrownBy(() -> consumer.consumir(mensaje(cuerpo)))
                    .isInstanceOf(AmqpRejectAndDontRequeueException.class);
        }
        verifyNoInteractions(seguimientos);
    }

    private static String evento(String tipo, String usuarioId) {
        return "{\"eventId\":\"" + UUID.randomUUID() + "\",\"timestamp\":\"2026-11-25T15:00:00Z\","
                + "\"traceId\":\"aabbccddeeff00112233445566778899\",\"eventType\":\"" + tipo + "\","
                + "\"payload\":{\"usuarioId\":" + usuarioId + ",\"rolAnterior\":\"CLIENTE\","
                + "\"anonimizadoAt\":\"2026-11-25T15:00:00Z\",\"origen\":\"baja_propia\"}}";
    }

    private static Message mensaje(String cuerpo) {
        return new Message(cuerpo.getBytes(StandardCharsets.UTF_8), new MessageProperties());
    }
}
