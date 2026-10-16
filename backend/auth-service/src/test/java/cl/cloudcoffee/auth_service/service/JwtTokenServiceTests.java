package cl.cloudcoffee.auth_service.service;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import cl.cloudcoffee.auth_service.model.AsignacionCafeteria;
import cl.cloudcoffee.auth_service.model.Rol;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.AsignacionCafeteriaRepository;
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
    @Autowired AsignacionCafeteriaRepository asignaciones;

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
        assertThatIllegalArgumentException().isThrownBy(() -> new JwtTokenService(encoder, asignaciones, Duration.ZERO));
        assertThatIllegalArgumentException().isThrownBy(() -> new JwtTokenService(encoder, asignaciones, Duration.ofSeconds(-1)));
    }

    @ParameterizedTest
    @EnumSource(value = Rol.class, names = {"CAJERO", "ADMIN_CAFETERIA"})
    void staffTokenCarriesPersistedCafeteria(Rol role) {
        Usuario user = save(role);
        UUID cafeteriaId = UUID.randomUUID();
        asignaciones.saveAndFlush(new AsignacionCafeteria(user.getId(), cafeteriaId));

        var jwt = decoder.decode(tokens.emitir(user));

        assertThat(jwt.getClaimAsString("cafeteriaId")).isEqualTo(cafeteriaId.toString());
    }

    @ParameterizedTest
    @EnumSource(value = Rol.class, names = {"CAJERO", "ADMIN_CAFETERIA"})
    void staffWithoutAssignmentGetsTokenWithoutCafeteria(Rol role) {
        var jwt = decoder.decode(tokens.emitir(save(role)));

        assertThat(jwt.getClaims()).doesNotContainKey("cafeteriaId");
    }

    @ParameterizedTest
    @EnumSource(value = Rol.class, names = {"CLIENTE", "SUPER_ADMIN"})
    void nonStaffNeverCarriesCafeteriaEvenWithStrayAssignment(Rol role) {
        Usuario user = save(role);
        asignaciones.saveAndFlush(new AsignacionCafeteria(user.getId(), UUID.randomUUID()));

        var jwt = decoder.decode(tokens.emitir(user));

        assertThat(jwt.getClaims()).doesNotContainKey("cafeteriaId");
    }

    private Usuario save(Rol role) {
        return users.saveAndFlush(new Usuario(UUID.randomUUID() + "@example.com",
                "password-hash", role, "Ana", "Perez", "+56912345678"));
    }

}
