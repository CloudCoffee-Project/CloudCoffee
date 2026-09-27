package cl.cloudcoffee.auth_service.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.util.ReflectionUtils;

import cl.cloudcoffee.auth_service.dto.LoginResponse;
import cl.cloudcoffee.auth_service.model.Rol;
import cl.cloudcoffee.auth_service.model.TipoToken;
import cl.cloudcoffee.auth_service.model.TokenAuth;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.TokenAuthRepository;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.errors.BusinessException;

@ExtendWith(MockitoExtension.class)
class LoginServiceTest {

    @Mock
    private UsuarioRepository usuarioRepository;

    @Mock
    private PasswordEncoder passwordEncoder;

    @Mock
    private TokenAuthRepository tokenAuthRepository;

    @Mock
    private JwtTokenService jwtTokenService;

    private LoginService loginService;

    @BeforeEach
    void setUp() {
        loginService = new LoginService(usuarioRepository, passwordEncoder, tokenAuthRepository, jwtTokenService,
                Duration.ofDays(30));
    }

    private Usuario usuarioVerificado() {
        Usuario usuario = new Usuario("cliente@cloudcoffee.cl", "hash-almacenado", Rol.CLIENTE, "Ana", "Pérez",
                "+56912345678");
        usuario.verificar();
        return conIdAsignado(usuario);
    }

    /** Simula la asignación de id que hace JPA al persistir, ausente cuando se usa un repositorio mockeado. */
    private static Usuario conIdAsignado(Usuario usuario) {
        var idField = ReflectionUtils.findField(Usuario.class, "id");
        ReflectionUtils.makeAccessible(idField);
        ReflectionUtils.setField(idField, usuario, UUID.randomUUID());
        return usuario;
    }

    @Test
    void iniciaSesionConCredencialesValidasYCuentaVerificada() {
        Usuario usuario = usuarioVerificado();
        when(usuarioRepository.findByEmail(usuario.getEmail())).thenReturn(Optional.of(usuario));
        when(passwordEncoder.matches("password123", usuario.getPasswordHash())).thenReturn(true);
        when(jwtTokenService.emitir(usuario)).thenReturn("access-token-firmado");

        LoginResponse response = loginService.iniciarSesion(usuario.getEmail(), "password123");

        assertThat(response.accessToken()).isEqualTo("access-token-firmado");
        assertThat(response.refreshToken()).isNotBlank();

        ArgumentCaptor<TokenAuth> captor = ArgumentCaptor.forClass(TokenAuth.class);
        verify(tokenAuthRepository).save(captor.capture());
        assertThat(captor.getValue().getTipo()).isEqualTo(TipoToken.REFRESH);
        assertThat(captor.getValue().estaVigente()).isTrue();
    }

    @Test
    void comparaElPasswordMedianteHashNoEnTextoPlano() {
        Usuario usuario = usuarioVerificado();
        when(usuarioRepository.findByEmail(usuario.getEmail())).thenReturn(Optional.of(usuario));
        when(passwordEncoder.matches("password123", usuario.getPasswordHash())).thenReturn(true);
        when(jwtTokenService.emitir(usuario)).thenReturn("access-token-firmado");

        loginService.iniciarSesion(usuario.getEmail(), "password123");

        verify(passwordEncoder).matches("password123", usuario.getPasswordHash());
    }

    @Test
    void rechazaEmailInexistente() {
        when(usuarioRepository.findByEmail("no-existe@cloudcoffee.cl")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> loginService.iniciarSesion("no-existe@cloudcoffee.cl", "password123"))
                .isInstanceOf(BusinessException.class)
                .satisfies(exception -> assertThat(((BusinessException) exception).getStatus().value()).isEqualTo(401));

        verify(tokenAuthRepository, never()).save(any());
    }

    @Test
    void rechazaPasswordIncorrecto() {
        Usuario usuario = usuarioVerificado();
        when(usuarioRepository.findByEmail(usuario.getEmail())).thenReturn(Optional.of(usuario));
        when(passwordEncoder.matches("password-incorrecto", usuario.getPasswordHash())).thenReturn(false);

        assertThatThrownBy(() -> loginService.iniciarSesion(usuario.getEmail(), "password-incorrecto"))
                .isInstanceOf(BusinessException.class)
                .satisfies(exception -> assertThat(((BusinessException) exception).getStatus().value()).isEqualTo(401));

        verify(tokenAuthRepository, never()).save(any());
    }

    @Test
    void rechazaCuentaNoVerificadaConErrorEspecifico() {
        Usuario usuario = new Usuario("sin-verificar@cloudcoffee.cl", "hash-almacenado", Rol.CLIENTE, "Ana", "Pérez",
                "+56912345678");
        conIdAsignado(usuario);
        when(usuarioRepository.findByEmail(usuario.getEmail())).thenReturn(Optional.of(usuario));
        when(passwordEncoder.matches("password123", usuario.getPasswordHash())).thenReturn(true);

        assertThatThrownBy(() -> loginService.iniciarSesion(usuario.getEmail(), "password123"))
                .isInstanceOf(BusinessException.class)
                .satisfies(exception -> assertThat(((BusinessException) exception).getStatus().value()).isEqualTo(403));

        verify(tokenAuthRepository, never()).save(any());
        verify(jwtTokenService, never()).emitir(any());
    }
}
