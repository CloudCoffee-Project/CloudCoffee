package cl.cloudcoffee.auth_service.service;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import cl.cloudcoffee.auth_service.model.Rol;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import static org.assertj.core.api.Assertions.*;

@SpringBootTest(properties = "spring.rabbitmq.listener.simple.auto-startup=false")
class JwtTokenServiceTests extends JwtTestSupport {
    @DynamicPropertySource
    static void privateKey(DynamicPropertyRegistry registry) {
        registry.add("JWT_PRIVATE_KEY_LOCATION", () -> PRIVATE_KEY_LOCATION);
    }

    @Autowired JwtTokenService tokens;
    @Autowired JwtDecoder decoder;
    @Autowired JwtEncoder encoder;
    @Autowired UsuarioRepository users;

    @ParameterizedTest
    @EnumSource(Rol.class)
    void signsThePersistedUserIdentityAndActualRole(Rol role) {
        Usuario user = users.saveAndFlush(new Usuario(UUID.randomUUID() + "@example.com",
                "password-hash", role, "Ana", "Perez", "+56912345678"));
        var jwt = decoder.decode(tokens.emitir(user));
        assertThat(jwt.getHeaders().get("alg")).isEqualTo("RS256");
        assertThat(jwt.getSubject()).isEqualTo(user.getId().toString());
        assertThat(jwt.getClaimAsString("role")).isEqualTo(role.name());
        assertThat(jwt.getExpiresAt()).isAfter(Instant.now());
        assertThat(Duration.between(jwt.getIssuedAt(), jwt.getExpiresAt())).isEqualTo(Duration.ofMinutes(15));
        assertThat(jwt.getClaims()).doesNotContainKeys("password", "passwordHash", "email");
    }

    @Test
    void rejectsNonPositiveLifetime() {
        assertThatIllegalArgumentException().isThrownBy(() -> new JwtTokenService(encoder, Duration.ZERO));
        assertThatIllegalArgumentException().isThrownBy(() -> new JwtTokenService(encoder, Duration.ofSeconds(-1)));
    }

}
