package cl.cloudcoffee.auth_service.model;

import org.junit.jupiter.api.Test;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.*;

class TokenAuthTest {

    private Usuario usuarioDePrueba() {
        return new Usuario("test@cloudcoffee.cl", "hash", Rol.CLIENTE, "Test", "Usuario", "+56900000000");
    }

    @Test
    void tokenVigenteMientrasNoExpireNiSeRevoque() {
        TokenAuth token = new TokenAuth(usuarioDePrueba(), "hash", Instant.now().plusSeconds(3600), TipoToken.REFRESH);
        assertTrue(token.estaVigente());
    }

    @Test
    void tokenVencidoNoEstaVigente() {
        TokenAuth token = new TokenAuth(usuarioDePrueba(), "hash", Instant.now().minusSeconds(10), TipoToken.REFRESH);
        assertFalse(token.estaVigente());
    }

    @Test
    void tokenRevocadoNoEstaVigenteAunSinExpirar() {
        TokenAuth token = new TokenAuth(usuarioDePrueba(), "hash", Instant.now().plusSeconds(3600), TipoToken.REFRESH);
        token.revocar();
        assertFalse(token.estaVigente());
    }
}
