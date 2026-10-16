package cl.cloudcoffee.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

class CafeteriaAccessTests {

    static final UUID PROPIA = UUID.randomUUID();
    static final UUID AJENA = UUID.randomUUID();

    final CafeteriaAccess access = new CafeteriaAccess();

    @ParameterizedTest
    @ValueSource(strings = {"CAJERO", "ADMIN_CAFETERIA"})
    void personalOperaSoloSuCafeteria(String role) {
        var auth = token(role, PROPIA.toString());

        assertThat(access.puedeOperar(auth, PROPIA)).isTrue();
        assertThat(access.puedeOperar(auth, AJENA)).isFalse();
        assertThatThrownBy(() -> access.verificar(auth, AJENA)).isInstanceOf(AccessDeniedException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"CAJERO", "ADMIN_CAFETERIA"})
    void personalSinAsignacionNoOperaNinguna(String role) {
        assertThat(access.puedeOperar(token(role, null), PROPIA)).isFalse();
    }

    @Test
    void clienteNoOperaCafeterias() {
        assertThat(access.puedeOperar(token("CLIENTE", null), PROPIA)).isFalse();
    }

    @Test
    void superAdminOperaCualquierCafeteria() {
        assertThat(access.puedeOperar(token("SUPER_ADMIN", null), AJENA)).isTrue();
    }

    @Test
    void sinJwtOSinCafeteriaNoAutoriza() {
        assertThat(access.puedeOperar(new TestingAuthenticationToken("x", "y", "ROLE_SUPER_ADMIN"), PROPIA)).isFalse();
        assertThat(access.puedeOperar(null, PROPIA)).isFalse();
        assertThat(access.puedeOperar(token("SUPER_ADMIN", null), null)).isFalse();
    }

    private static JwtAuthenticationToken token(String role, String cafeteriaId) {
        var jwt = Jwt.withTokenValue("token").header("alg", "RS256")
                .subject(UUID.randomUUID().toString()).claim("role", role)
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60));
        if (cafeteriaId != null) {
            jwt.claim(CafeteriaAccess.CLAIM, cafeteriaId);
        }
        return new JwtAuthenticationToken(jwt.build());
    }
}
