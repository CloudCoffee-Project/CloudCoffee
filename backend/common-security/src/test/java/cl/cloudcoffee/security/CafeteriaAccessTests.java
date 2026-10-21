package cl.cloudcoffee.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

/** INT2-65 alineado con INT2-50: la asignación sale de auth-service, no del claim del JWT. */
class CafeteriaAccessTests {

    static final UUID USUARIO = UUID.randomUUID();
    static final UUID PROPIA = UUID.randomUUID();
    static final UUID AJENA = UUID.randomUUID();

    // Auth-service simulado: USUARIO tiene asignada PROPIA.
    final CafeteriaAccess access = new CafeteriaAccess(
            usuario -> usuario.equals(USUARIO) ? Optional.of(PROPIA) : Optional.empty());

    @ParameterizedTest
    @ValueSource(strings = {"CAJERO", "ADMIN_CAFETERIA"})
    void personalOperaSoloLaCafeteriaPersistida(String role) {
        var auth = token(USUARIO, role, null);

        assertThat(access.puedeOperar(auth, PROPIA)).isTrue();
        assertThat(access.puedeOperar(auth, AJENA)).isFalse();
        assertThatThrownBy(() -> access.verificar(auth, AJENA)).isInstanceOf(AccessDeniedException.class);
    }

    @Test
    void ignoraElClaimDeCafeteriaDelJwt() {
        // El token dice AJENA, pero Auth tiene persistida PROPIA: manda Auth.
        var auth = token(USUARIO, "CAJERO", AJENA);

        assertThat(access.puedeOperar(auth, AJENA)).isFalse();
        assertThat(access.puedeOperar(auth, PROPIA)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"CAJERO", "ADMIN_CAFETERIA"})
    void personalSinAsignacionNoOperaNingunaAunqueElTokenTraigaCafeteria(String role) {
        assertThat(access.puedeOperar(token(UUID.randomUUID(), role, PROPIA), PROPIA)).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"CLIENTE", "SUPER_ADMIN"})
    void rolesQueNoSonPersonalNoHeredanPermisos(String role) {
        // Ni siquiera con una asignación persistida a su nombre.
        assertThat(access.puedeOperar(token(USUARIO, role, null), PROPIA)).isFalse();
    }

    @Test
    void siNoSePuedeVerificarLaAsignacionFallaCerrado() {
        CafeteriaAccess sinAuth = new CafeteriaAccess(usuario -> {
            throw new AsignacionNoVerificableException("auth-service no responde", null);
        });

        assertThat(sinAuth.puedeOperar(token(USUARIO, "CAJERO", PROPIA), PROPIA)).isFalse();
    }

    @Test
    void sinJwtSinCafeteriaOConSubjectInvalidoNoAutoriza() {
        assertThat(access.puedeOperar(new TestingAuthenticationToken("x", "y", "ROLE_CAJERO"), PROPIA)).isFalse();
        assertThat(access.puedeOperar(null, PROPIA)).isFalse();
        assertThat(access.puedeOperar(token(USUARIO, "CAJERO", null), null)).isFalse();
        var jwt = Jwt.withTokenValue("t").header("alg", "RS256").subject("no-es-uuid")
                .claims(claims -> claims.putAll(Map.of("role", "CAJERO")))
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60)).build();
        assertThat(access.puedeOperar(new JwtAuthenticationToken(jwt), PROPIA)).isFalse();
    }

    private static JwtAuthenticationToken token(UUID usuario, String role, UUID cafeteriaClaim) {
        var jwt = Jwt.withTokenValue("token").header("alg", "RS256")
                .subject(usuario.toString()).claim("role", role)
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60));
        if (cafeteriaClaim != null) {
            jwt.claim(CafeteriaAccess.CLAIM, cafeteriaClaim.toString());
        }
        return new JwtAuthenticationToken(jwt.build());
    }
}
