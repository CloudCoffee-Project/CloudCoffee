package cl.cloudcoffee.order_service.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.File;
import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class EventoResultadoPaymentTests {

    final JsonMapper json = JsonMapper.builder().build();

    @Test
    void readsEveryExampleOfThePaymentEventContract() {
        JsonNode esquema = json.readTree(new File("../docs/payment-service.eventos.json"));
        for (JsonNode ejemplo : esquema.path("examples")) {
            var resultado = EventoResultadoPayment.leer(json.writeValueAsBytes(ejemplo));
            assertThat(resultado.eventId().toString()).isEqualTo(ejemplo.path("eventId").asString());
            assertThat(resultado.estado()).isEqualTo(ejemplo.path("payload").path("estado").asString());
            assertThat(resultado.version()).isEqualTo(ejemplo.path("payload").path("version").asLong());
            assertThat(resultado.montoTotal()).isEqualTo(4800);
        }
        assertThat(esquema.path("examples").size()).isGreaterThan(0);
    }

    @ParameterizedTest
    @ValueSource(strings = {"\"eventType\":\"payment.pago.resultado.v1\"|\"eventType\":\"order.pago.resultado.v1\"",
            "\"estado\":\"aprobado\"|\"estado\":\"pagado\"", "\"moneda\":\"CLP\"|\"moneda\":\"USD\"",
            "\"entorno\":\"sandbox\"|\"entorno\":\"produccion\"", "\"montoTotal\":4800|\"montoTotal\":4800.5",
            "\"version\":2|\"version\":0", "\"paymentId\":\"91000000-0000-4000-8000-000000000001\"|\"paymentId\":\"x\"",
            "\"traceId\":\"0123456789abcdef0123456789abcdef\"|\"traceId\":\"corto\""})
    void rejectsEventsOutsideTheContract(String cambio) {
        JsonNode ejemplo = json.readTree(new File("../docs/payment-service.eventos.json")).path("examples").get(0);
        String[] partes = cambio.split("\\|");
        String texto = json.writeValueAsString(ejemplo);
        assertThat(texto).contains(partes[0]);
        byte[] alterado = texto.replace(partes[0], partes[1]).getBytes(StandardCharsets.UTF_8);
        assertThatThrownBy(() -> EventoResultadoPayment.leer(alterado)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsNonJsonOrNonObjects() {
        assertThatThrownBy(() -> EventoResultadoPayment.leer("no-json".getBytes())).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> EventoResultadoPayment.leer("[]".getBytes())).isInstanceOf(IllegalArgumentException.class);
    }
}
