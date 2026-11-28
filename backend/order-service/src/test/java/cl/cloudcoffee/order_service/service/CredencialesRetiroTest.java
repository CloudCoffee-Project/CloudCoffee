package cl.cloudcoffee.order_service.service;

import static org.assertj.core.api.Assertions.*;

import cl.cloudcoffee.order_service.dto.QrRetiroResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class CredencialesRetiroTest {
    static final String KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

    @Test
    void conserva256BitsAleatoriosCifradosYRecuperablesTrasReinicio() throws Exception {
        UUID orden = UUID.randomUUID();
        var credenciales = new CredencialesRetiro(KEY);
        var primera = credenciales.emitir(orden);
        String codigo = credenciales.recuperar(orden, primera.cifrado());

        assertThat(codigo).matches("[A-Za-z0-9_-]{43}");
        assertThat(Base64.getUrlDecoder().decode(codigo)).hasSize(32);
        assertThat(primera.hash()).isEqualTo(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(codigo.getBytes(StandardCharsets.US_ASCII))));
        assertThat(primera.cifrado()).doesNotContain(codigo);
        assertThat(new CredencialesRetiro(KEY).recuperar(orden, primera.cifrado())).isEqualTo(codigo);
        assertThat(credenciales.emitir(orden)).isNotEqualTo(primera);
        assertThat(new QrRetiroResponse(orden, codigo, Instant.now()).toString()).doesNotContain(codigo);
    }

    @Test
    void rechazaCiphertextAlteradoOtraOrdenYOtraClaveSinFiltrarElCodigo() {
        var credenciales = new CredencialesRetiro(KEY);
        UUID orden = UUID.randomUUID();
        var guardada = credenciales.emitir(orden);
        byte[] alterada = Base64.getDecoder().decode(guardada.cifrado());
        alterada[alterada.length - 1] ^= 1;
        assertNoDisponible(() -> credenciales.recuperar(orden, Base64.getEncoder().encodeToString(alterada)));
        assertNoDisponible(() -> credenciales.recuperar(UUID.randomUUID(), guardada.cifrado()));
        String otraClave = Base64.getEncoder().encodeToString(new byte[32]);
        assertNoDisponible(() -> new CredencialesRetiro(otraClave).recuperar(orden, guardada.cifrado()));
    }

    @Test
    void noGeneraClavesEfimerasCuandoFaltaConfiguracion() {
        assertNoDisponible(() -> new CredencialesRetiro("").emitir(UUID.randomUUID()));
        assertNoDisponible(() -> new CredencialesRetiro("invalida").emitir(UUID.randomUUID()));
    }

    private static void assertNoDisponible(org.assertj.core.api.ThrowableAssert.ThrowingCallable action) {
        assertThatThrownBy(action).isInstanceOfSatisfying(ResponseStatusException.class,
                exception -> assertThat(exception.getStatusCode().value()).isEqualTo(503));
    }
}
