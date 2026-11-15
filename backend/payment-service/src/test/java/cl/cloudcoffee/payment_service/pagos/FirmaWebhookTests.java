package cl.cloudcoffee.payment_service.pagos;

import java.time.Duration;
import java.time.Instant;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import cl.cloudcoffee.payment_service.pagos.FirmaWebhook.Invalida;
import cl.cloudcoffee.payment_service.pagos.FirmaWebhook.Valida;

import static org.assertj.core.api.Assertions.assertThat;

class FirmaWebhookTests {

    static final String SECRETO = "secreto-de-prueba-webhook";
    static final Instant AHORA = Instant.parse("2026-11-13T15:02:00Z");
    static final Duration TOLERANCIA = Duration.ofMinutes(5);
    static final String TS = String.valueOf(AHORA.getEpochSecond());
    static final String CEROS = "0000000000000000000000000000000000000000000000000000000000000000";

    static String firma(String secreto, String dataId, String requestId, String ts) {
        return "ts=" + ts + ",v1=" + FirmaWebhook.hmac(secreto, FirmaWebhook.manifiesto(dataId, requestId, ts));
    }

    FirmaWebhook.Resultado verificar(String firma, String requestId, String dataId) {
        return FirmaWebhook.verificar(SECRETO, firma, requestId, dataId, AHORA, TOLERANCIA);
    }

    @Test
    void manifestFollowsTheOfficialTemplate() {
        assertThat(FirmaWebhook.manifiesto("123456", "req-1", "1704908010"))
                .isEqualTo("id:123456;request-id:req-1;ts:1704908010;");
        // data.id alfanumérico se firma en minúsculas.
        assertThat(FirmaWebhook.manifiesto("ABC123", "req-1", "1")).isEqualTo("id:abc123;request-id:req-1;ts:1;");
    }

    @Test
    void acceptsAValidSignatureInSecondsOrMilliseconds() {
        assertThat(verificar(firma(SECRETO, "123456", "req-1", TS), "req-1", "123456")).isInstanceOf(Valida.class);
        String ms = String.valueOf(AHORA.toEpochMilli());
        assertThat(verificar(firma(SECRETO, "123456", "req-1", ms), "req-1", "123456")).isInstanceOf(Valida.class);
        // Espacios y v1 en mayúsculas son tolerados; el orden de las partes no importa.
        String v1 = FirmaWebhook.hmac(SECRETO, FirmaWebhook.manifiesto("123456", "req-1", TS)).toUpperCase();
        assertThat(verificar("v1=" + v1 + ", ts=" + TS, "req-1", "123456")).isInstanceOf(Valida.class);
    }

    @Test
    void alphanumericDataIdIsComparedInLowercase() {
        assertThat(verificar(firma(SECRETO, "abc123", "req-1", TS), "req-1", "ABC123")).isInstanceOf(Valida.class);
    }

    @Test
    void anyChangeToTheSignedValuesInvalidatesTheSignature() {
        String valida = firma(SECRETO, "123456", "req-1", TS);
        assertThat(verificar(valida, "req-1", "123457")).isInstanceOf(Invalida.class);
        assertThat(verificar(valida, "req-2", "123456")).isInstanceOf(Invalida.class);
        assertThat(verificar(firma("otro-secreto", "123456", "req-1", TS), "req-1", "123456")).isInstanceOf(Invalida.class);
        // Cambiar ts sin recalcular el HMAC.
        String otroTs = String.valueOf(AHORA.getEpochSecond() + 1);
        assertThat(verificar(valida.replace("ts=" + TS, "ts=" + otroTs), "req-1", "123456")).isInstanceOf(Invalida.class);
    }

    @Test
    void timestampsOutsideTheToleranceAreRejectedInBothDirections() {
        String viejo = String.valueOf(AHORA.minus(Duration.ofMinutes(6)).getEpochSecond());
        String futuro = String.valueOf(AHORA.plus(Duration.ofMinutes(6)).getEpochSecond());
        String limite = String.valueOf(AHORA.minus(TOLERANCIA).getEpochSecond());
        assertThat(verificar(firma(SECRETO, "1", "r", viejo), "r", "1")).isEqualTo(new Invalida("fuera de tolerancia"));
        assertThat(verificar(firma(SECRETO, "1", "r", futuro), "r", "1")).isEqualTo(new Invalida("fuera de tolerancia"));
        assertThat(verificar(firma(SECRETO, "1", "r", limite), "r", "1")).isInstanceOf(Valida.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "v1=abc", "ts=1704908010", "ts=abc,v1=" + CEROS, "ts=1,v1=xyz",
            "ts=1,ts=2,v1=" + CEROS, "garbage"})
    void malformedSignatureHeadersAreRejected(String cabecera) {
        assertThat(verificar(cabecera, "req-1", "123456")).isInstanceOf(Invalida.class);
    }

    @Test
    void incompleteInputOrMissingSecretIsRejected() {
        String valida = firma(SECRETO, "123456", "req-1", TS);
        assertThat(verificar(null, "req-1", "123456")).isInstanceOf(Invalida.class);
        assertThat(verificar(valida, null, "123456")).isInstanceOf(Invalida.class);
        assertThat(verificar(valida, "req-1", null)).isInstanceOf(Invalida.class);
        assertThat(FirmaWebhook.verificar("", valida, "req-1", "123456", AHORA, TOLERANCIA)).isInstanceOf(Invalida.class);
    }

    @Test
    void rejectionReasonsNeverContainTheSecretOrTheReceivedSignature() {
        String recibida = firma("otro-secreto", "123456", "req-1", TS);
        var resultado = (Invalida) verificar(recibida, "req-1", "123456");
        assertThat(resultado.motivo()).doesNotContain(SECRETO).doesNotContain(recibida.substring(recibida.indexOf("v1=") + 3));
    }
}
