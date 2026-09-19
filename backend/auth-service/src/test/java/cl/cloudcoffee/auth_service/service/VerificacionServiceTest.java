package cl.cloudcoffee.auth_service.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.util.ReflectionUtils;

import cl.cloudcoffee.auth_service.dto.VerificacionCorreoResponse;
import cl.cloudcoffee.auth_service.messaging.AuthEventPublisher;
import cl.cloudcoffee.auth_service.model.Rol;
import cl.cloudcoffee.auth_service.model.TipoToken;
import cl.cloudcoffee.auth_service.model.TokenAuth;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.TokenAuthRepository;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.errors.BusinessException;

@ExtendWith(MockitoExtension.class)
class VerificacionServiceTest {

    @Mock
    private UsuarioRepository usuarioRepository;

    @Mock
    private TokenAuthRepository tokenAuthRepository;

    @Mock
    private AuthEventPublisher eventPublisher;

    @InjectMocks
    private VerificacionService verificacionService;

    private Usuario usuarioDePrueba() {
        Usuario usuario = new Usuario("cliente@cloudcoffee.cl", "hash", Rol.CLIENTE, "Ana", "Pérez", "+56912345678");
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
    void solicitarVerificacionGeneraTokenYPublicaElEvento() {
        Usuario usuario = usuarioDePrueba();
        when(tokenAuthRepository.findByUsuarioIdAndTipoAndRevokedAtIsNull(usuario.getId(), TipoToken.VERIFICACION_CORREO))
                .thenReturn(List.of());

        verificacionService.solicitarVerificacion(usuario, "trace-1");

        ArgumentCaptor<TokenAuth> captor = ArgumentCaptor.forClass(TokenAuth.class);
        verify(tokenAuthRepository).save(captor.capture());
        assertThat(captor.getValue().getTipo()).isEqualTo(TipoToken.VERIFICACION_CORREO);
        assertThat(captor.getValue().estaVigente()).isTrue();

        verify(eventPublisher).publishSolicitudVerificacionCorreo(
                anyString(), eq(usuario.getEmail()), anyString(), any(Instant.class), eq("trace-1"));
    }

    @Test
    void solicitarVerificacionRevocaTokensAnterioresVigentes() {
        Usuario usuario = usuarioDePrueba();
        TokenAuth tokenAnterior = new TokenAuth(usuario, "hash-anterior", Instant.now().plusSeconds(3600),
                TipoToken.VERIFICACION_CORREO);
        when(tokenAuthRepository.findByUsuarioIdAndTipoAndRevokedAtIsNull(usuario.getId(), TipoToken.VERIFICACION_CORREO))
                .thenReturn(List.of(tokenAnterior));

        verificacionService.solicitarVerificacion(usuario, "trace-1");

        assertThat(tokenAnterior.estaVigente()).isFalse();
    }

    @Test
    void verificarCorreoConTokenValidoMarcaLaCuentaComoVerificada() {
        Usuario usuario = usuarioDePrueba();
        TokenAuth token = new TokenAuth(usuario, "hash-cualquiera", Instant.now().plusSeconds(3600),
                TipoToken.VERIFICACION_CORREO);
        when(tokenAuthRepository.findByTokenHashAndTipo(anyString(), eq(TipoToken.VERIFICACION_CORREO)))
                .thenReturn(Optional.of(token));

        VerificacionCorreoResponse response = verificacionService.verificarCorreo("token-plano");

        assertThat(response.email()).isEqualTo(usuario.getEmail());
        assertThat(response.verificado()).isTrue();
        assertThat(usuario.isVerificado()).isTrue();
        assertThat(token.estaVigente()).isFalse();
    }

    @Test
    void rechazaTokenInexistente() {
        when(tokenAuthRepository.findByTokenHashAndTipo(anyString(), eq(TipoToken.VERIFICACION_CORREO)))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> verificacionService.verificarCorreo("token-invalido"))
                .isInstanceOf(BusinessException.class)
                .satisfies(exception -> assertThat(((BusinessException) exception).getStatus().value()).isEqualTo(400));
    }

    @Test
    void rechazaTokenExpirado() {
        Usuario usuario = usuarioDePrueba();
        TokenAuth tokenExpirado = new TokenAuth(usuario, "hash-expirado", Instant.now().minusSeconds(10),
                TipoToken.VERIFICACION_CORREO);
        when(tokenAuthRepository.findByTokenHashAndTipo(anyString(), eq(TipoToken.VERIFICACION_CORREO)))
                .thenReturn(Optional.of(tokenExpirado));

        assertThatThrownBy(() -> verificacionService.verificarCorreo("token-expirado"))
                .isInstanceOf(BusinessException.class);
        assertThat(usuario.isVerificado()).isFalse();
    }

    @Test
    void rechazaTokenYaUtilizado() {
        Usuario usuario = usuarioDePrueba();
        TokenAuth tokenUsado = new TokenAuth(usuario, "hash-usado", Instant.now().plusSeconds(3600),
                TipoToken.VERIFICACION_CORREO);
        tokenUsado.revocar();
        when(tokenAuthRepository.findByTokenHashAndTipo(anyString(), eq(TipoToken.VERIFICACION_CORREO)))
                .thenReturn(Optional.of(tokenUsado));

        assertThatThrownBy(() -> verificacionService.verificarCorreo("token-usado"))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void reenviarVerificacionRechazaEmailInexistente() {
        when(usuarioRepository.findByEmail("no-existe@cloudcoffee.cl")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> verificacionService.reenviarVerificacion("no-existe@cloudcoffee.cl", "trace-1"))
                .isInstanceOf(BusinessException.class)
                .satisfies(exception -> assertThat(((BusinessException) exception).getStatus().value()).isEqualTo(404));
    }

    @Test
    void reenviarVerificacionRechazaCuentaYaVerificada() {
        Usuario usuario = usuarioDePrueba();
        usuario.verificar();
        when(usuarioRepository.findByEmail(usuario.getEmail())).thenReturn(Optional.of(usuario));

        assertThatThrownBy(() -> verificacionService.reenviarVerificacion(usuario.getEmail(), "trace-1"))
                .isInstanceOf(BusinessException.class)
                .satisfies(exception -> assertThat(((BusinessException) exception).getStatus().value()).isEqualTo(409));

        verify(tokenAuthRepository, never()).save(any());
    }

    @Test
    void reenviarVerificacionNoCreaUnSegundoUsuario() {
        Usuario usuario = usuarioDePrueba();
        when(usuarioRepository.findByEmail(usuario.getEmail())).thenReturn(Optional.of(usuario));
        when(tokenAuthRepository.findByUsuarioIdAndTipoAndRevokedAtIsNull(usuario.getId(), TipoToken.VERIFICACION_CORREO))
                .thenReturn(List.of());

        verificacionService.reenviarVerificacion(usuario.getEmail(), "trace-1");

        verify(usuarioRepository, never()).save(any());
        verify(tokenAuthRepository, times(1)).save(any(TokenAuth.class));
        verify(eventPublisher).publishSolicitudVerificacionCorreo(
                anyString(), eq(usuario.getEmail()), anyString(), any(Instant.class), eq("trace-1"));
    }
}
