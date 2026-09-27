package cl.cloudcoffee.auth_service.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.util.ReflectionUtils;

import cl.cloudcoffee.auth_service.dto.LoginResponse;
import cl.cloudcoffee.auth_service.model.Rol;
import cl.cloudcoffee.auth_service.model.TipoToken;
import cl.cloudcoffee.auth_service.model.TokenAuth;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.TokenAuthRepository;
import cl.cloudcoffee.errors.BusinessException;

@ExtendWith(MockitoExtension.class)
class RefreshTokenServiceTest {

    @Mock
    private TokenAuthRepository tokenAuthRepository;

    @Mock
    private JwtTokenService jwtTokenService;

    private RefreshTokenService refreshTokenService;

    @BeforeEach
    void setUp() {
        refreshTokenService = new RefreshTokenService(tokenAuthRepository, jwtTokenService, Duration.ofDays(30));
    }

    private static Usuario usuarioDePrueba() {
        Usuario usuario = new Usuario("cliente@cloudcoffee.cl", "hash-almacenado", Rol.CLIENTE, "Ana", "Pérez",
                "+56912345678");
        usuario.verificar();
        var idField = ReflectionUtils.findField(Usuario.class, "id");
        ReflectionUtils.makeAccessible(idField);
        ReflectionUtils.setField(idField, usuario, UUID.randomUUID());
        return usuario;
    }

    private static TokenAuth tokenVigente(Usuario usuario, String tokenHash) {
        return new TokenAuth(usuario, tokenHash, Instant.now().plus(Duration.ofDays(30)), TipoToken.REFRESH);
    }

    @Test
    void unRefreshTokenValidoGeneraNuevoAccessTokenYNuevoRefreshToken() {
        Usuario usuario = usuarioDePrueba();
        String tokenPlano = TokenHasher.generarTokenPlano();
        TokenAuth tokenActual = tokenVigente(usuario, TokenHasher.hash(tokenPlano));
        when(tokenAuthRepository.findByTokenHashAndTipo(TokenHasher.hash(tokenPlano), TipoToken.REFRESH))
                .thenReturn(Optional.of(tokenActual));
        when(jwtTokenService.emitir(usuario)).thenReturn("access-token-nuevo");

        LoginResponse response = refreshTokenService.renovar(tokenPlano);

        assertThat(response.accessToken()).isEqualTo("access-token-nuevo");
        assertThat(response.refreshToken()).isNotBlank();
        assertThat(response.refreshToken()).isNotEqualTo(tokenPlano);
    }

    @Test
    void elRefreshTokenAnteriorQuedaInvalidado() {
        Usuario usuario = usuarioDePrueba();
        String tokenPlano = TokenHasher.generarTokenPlano();
        TokenAuth tokenActual = tokenVigente(usuario, TokenHasher.hash(tokenPlano));
        when(tokenAuthRepository.findByTokenHashAndTipo(TokenHasher.hash(tokenPlano), TipoToken.REFRESH))
                .thenReturn(Optional.of(tokenActual));
        when(jwtTokenService.emitir(usuario)).thenReturn("access-token-nuevo");

        refreshTokenService.renovar(tokenPlano);

        assertThat(tokenActual.estaVigente()).isFalse();
        assertThat(tokenActual.getRevokedAt()).isNotNull();

        ArgumentCaptor<TokenAuth> captor = ArgumentCaptor.forClass(TokenAuth.class);
        verify(tokenAuthRepository, times(1)).save(captor.capture());
        assertThat(captor.getValue()).isNotSameAs(tokenActual);
        assertThat(captor.getValue().estaVigente()).isTrue();
    }

    @Test
    void reutilizarElTokenAnteriorNoFunciona() {
        Usuario usuario = usuarioDePrueba();
        String tokenPlano = TokenHasher.generarTokenPlano();
        TokenAuth tokenYaRevocado = tokenVigente(usuario, TokenHasher.hash(tokenPlano));
        tokenYaRevocado.revocar();
        when(tokenAuthRepository.findByTokenHashAndTipo(TokenHasher.hash(tokenPlano), TipoToken.REFRESH))
                .thenReturn(Optional.of(tokenYaRevocado));

        assertThatThrownBy(() -> refreshTokenService.renovar(tokenPlano))
                .isInstanceOf(BusinessException.class)
                .satisfies(exception -> assertThat(((BusinessException) exception).getStatus().value()).isEqualTo(401));

        verify(tokenAuthRepository, never()).save(any());
        verify(jwtTokenService, never()).emitir(any());
    }

    @Test
    void rechazaTokenExpirado() {
        Usuario usuario = usuarioDePrueba();
        String tokenPlano = TokenHasher.generarTokenPlano();
        TokenAuth tokenExpirado = new TokenAuth(usuario, TokenHasher.hash(tokenPlano),
                Instant.now().minus(Duration.ofMinutes(1)), TipoToken.REFRESH);
        when(tokenAuthRepository.findByTokenHashAndTipo(TokenHasher.hash(tokenPlano), TipoToken.REFRESH))
                .thenReturn(Optional.of(tokenExpirado));

        assertThatThrownBy(() -> refreshTokenService.renovar(tokenPlano))
                .isInstanceOf(BusinessException.class)
                .satisfies(exception -> assertThat(((BusinessException) exception).getStatus().value()).isEqualTo(401));

        verify(tokenAuthRepository, never()).save(any());
    }

    @Test
    void rechazaTokenInexistente() {
        String tokenPlano = TokenHasher.generarTokenPlano();
        when(tokenAuthRepository.findByTokenHashAndTipo(TokenHasher.hash(tokenPlano), TipoToken.REFRESH))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> refreshTokenService.renovar(tokenPlano))
                .isInstanceOf(BusinessException.class)
                .satisfies(exception -> assertThat(((BusinessException) exception).getStatus().value()).isEqualTo(401));

        verify(tokenAuthRepository, never()).save(any());
    }
}
