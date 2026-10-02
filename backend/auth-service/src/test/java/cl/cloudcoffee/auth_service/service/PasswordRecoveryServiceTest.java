package cl.cloudcoffee.auth_service.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Duration;
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
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.util.ReflectionUtils;

import cl.cloudcoffee.auth_service.messaging.AuthEventPublisher;
import cl.cloudcoffee.auth_service.model.Rol;
import cl.cloudcoffee.auth_service.model.TipoToken;
import cl.cloudcoffee.auth_service.model.TokenAuth;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.TokenAuthRepository;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.errors.BusinessException;

@ExtendWith(MockitoExtension.class)
class PasswordRecoveryServiceTest {

    @Mock
    private UsuarioRepository usuarioRepository;

    @Mock
    private TokenAuthRepository tokenAuthRepository;

    @Mock
    private PasswordEncoder passwordEncoder;

    @Mock
    private AuthEventPublisher eventPublisher;

    @InjectMocks
    private PasswordRecoveryService passwordRecoveryService;

    /** Simula la asignación de id que hace JPA al persistir, ausente cuando se usa un repositorio mockeado. */
    private static Usuario usuarioDePrueba() {
        Usuario usuario = new Usuario("cliente@cloudcoffee.cl", "hash-original", Rol.CLIENTE, "Ana", "Pérez",
                "+56912345678");
        usuario.verificar();
        var idField = ReflectionUtils.findField(Usuario.class, "id");
        ReflectionUtils.makeAccessible(idField);
        ReflectionUtils.setField(idField, usuario, UUID.randomUUID());
        return usuario;
    }

    /** No hay operación de dominio para eliminar usuarios todavía; se fuerza el estado persistido. */
    private static Usuario eliminado(Usuario usuario) {
        var field = ReflectionUtils.findField(Usuario.class, "eliminado");
        ReflectionUtils.makeAccessible(field);
        ReflectionUtils.setField(field, usuario, true);
        return usuario;
    }

    private static TokenAuth token(Usuario usuario, String tokenPlano, Instant expiresAt, TipoToken tipo) {
        return new TokenAuth(usuario, TokenHasher.hash(tokenPlano), expiresAt, tipo);
    }

    private static void assertTokenInvalido(Throwable exception) {
        BusinessException businessException = (BusinessException) exception;
        assertThat(businessException.getStatus().value()).isEqualTo(400);
        assertThat(businessException.getType().toString()).isEqualTo("/problems/token-recuperacion-invalido");
    }

    @Test
    void solicitarNormalizaElCorreoRevocaTokensPreviosYPublicaElEvento() {
        Usuario usuario = usuarioDePrueba();
        TokenAuth anterior = token(usuario, "anterior", Instant.now().plusSeconds(600),
                TipoToken.RECUPERACION_PASSWORD);
        when(usuarioRepository.findByEmailIgnoreCase("cliente@cloudcoffee.cl")).thenReturn(Optional.of(usuario));
        when(tokenAuthRepository.findByUsuarioIdAndTipoAndRevokedAtIsNull(usuario.getId(),
                TipoToken.RECUPERACION_PASSWORD)).thenReturn(List.of(anterior));

        passwordRecoveryService.solicitar("  Cliente@CloudCoffee.CL ", "trace-1");

        assertThat(anterior.estaVigente()).isFalse();
        ArgumentCaptor<TokenAuth> guardado = ArgumentCaptor.forClass(TokenAuth.class);
        verify(tokenAuthRepository).save(guardado.capture());
        assertThat(guardado.getValue().getTipo()).isEqualTo(TipoToken.RECUPERACION_PASSWORD);
        assertThat(guardado.getValue().getExpiresAt())
                .isBetween(Instant.now().plus(Duration.ofMinutes(59)), Instant.now().plus(Duration.ofHours(1)));

        ArgumentCaptor<String> tokenPublicado = ArgumentCaptor.forClass(String.class);
        verify(eventPublisher).publishSolicitudRecuperacionPassword(eq(usuario.getId().toString()),
                eq(usuario.getEmail()), tokenPublicado.capture(), eq(guardado.getValue().getExpiresAt()),
                eq("trace-1"));
        // Solo se persiste el hash; el token plano viaja únicamente en el evento.
        assertThat(guardado.getValue().getTokenHash()).isEqualTo(TokenHasher.hash(tokenPublicado.getValue()))
                .isNotEqualTo(tokenPublicado.getValue());
    }

    @Test
    void solicitarParaCorreoDesconocidoNoGeneraTokenNiEvento() {
        when(usuarioRepository.findByEmailIgnoreCase("nadie@cloudcoffee.cl")).thenReturn(Optional.empty());

        passwordRecoveryService.solicitar("nadie@cloudcoffee.cl", "trace-1");

        verifyNoInteractions(tokenAuthRepository, eventPublisher);
    }

    @Test
    void solicitarParaCuentaDesactivadaNoGeneraTokenNiEvento() {
        Usuario usuario = usuarioDePrueba();
        usuario.desactivar();
        when(usuarioRepository.findByEmailIgnoreCase(usuario.getEmail())).thenReturn(Optional.of(usuario));

        passwordRecoveryService.solicitar(usuario.getEmail(), "trace-1");

        verifyNoInteractions(tokenAuthRepository, eventPublisher);
    }

    @Test
    void solicitarParaCuentaEliminadaNoGeneraTokenNiEvento() {
        Usuario usuario = eliminado(usuarioDePrueba());
        when(usuarioRepository.findByEmailIgnoreCase(usuario.getEmail())).thenReturn(Optional.of(usuario));

        passwordRecoveryService.solicitar(usuario.getEmail(), "trace-1");

        verifyNoInteractions(tokenAuthRepository, eventPublisher);
    }

    @Test
    void restablecerCambiaPasswordYRevocaRecuperacionYSesiones() {
        Usuario usuario = usuarioDePrueba();
        TokenAuth recuperacion = token(usuario, "token-plano", Instant.now().plusSeconds(600),
                TipoToken.RECUPERACION_PASSWORD);
        TokenAuth sesionA = token(usuario, "refresh-a", Instant.now().plusSeconds(600), TipoToken.REFRESH);
        TokenAuth sesionB = token(usuario, "refresh-b", Instant.now().plusSeconds(600), TipoToken.REFRESH);
        when(tokenAuthRepository.findForUpdate(TokenHasher.hash("token-plano"), TipoToken.RECUPERACION_PASSWORD))
                .thenReturn(Optional.of(recuperacion));
        when(tokenAuthRepository.findByUsuarioIdAndTipoAndRevokedAtIsNull(usuario.getId(),
                TipoToken.RECUPERACION_PASSWORD)).thenReturn(List.of(recuperacion));
        when(tokenAuthRepository.findByUsuarioIdAndTipoAndRevokedAtIsNull(usuario.getId(), TipoToken.REFRESH))
                .thenReturn(List.of(sesionA, sesionB));
        when(passwordEncoder.encode("nuevaPassword123")).thenReturn("hash-nuevo");

        // El token llega desde un enlace de correo: se toleran espacios alrededor.
        passwordRecoveryService.restablecer("  token-plano\n", "nuevaPassword123");

        assertThat(usuario.getPasswordHash()).isEqualTo("hash-nuevo");
        assertThat(recuperacion.estaVigente()).isFalse();
        assertThat(sesionA.estaVigente()).isFalse();
        assertThat(sesionB.estaVigente()).isFalse();
    }

    @Test
    void restablecerRechazaTokenInexistente() {
        when(tokenAuthRepository.findForUpdate(anyString(), eq(TipoToken.RECUPERACION_PASSWORD)))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> passwordRecoveryService.restablecer("inexistente", "nuevaPassword123"))
                .isInstanceOf(BusinessException.class)
                .satisfies(PasswordRecoveryServiceTest::assertTokenInvalido);

        verifyNoInteractions(passwordEncoder);
    }

    @Test
    void restablecerRechazaTokenExpirado() {
        Usuario usuario = usuarioDePrueba();
        when(tokenAuthRepository.findForUpdate(TokenHasher.hash("expirado"), TipoToken.RECUPERACION_PASSWORD))
                .thenReturn(Optional.of(token(usuario, "expirado", Instant.now().minusSeconds(1),
                        TipoToken.RECUPERACION_PASSWORD)));

        assertThatThrownBy(() -> passwordRecoveryService.restablecer("expirado", "nuevaPassword123"))
                .isInstanceOf(BusinessException.class)
                .satisfies(PasswordRecoveryServiceTest::assertTokenInvalido);

        assertThat(usuario.getPasswordHash()).isEqualTo("hash-original");
        verifyNoInteractions(passwordEncoder);
    }

    @Test
    void restablecerRechazaTokenYaUtilizado() {
        Usuario usuario = usuarioDePrueba();
        TokenAuth usado = token(usuario, "usado", Instant.now().plusSeconds(600), TipoToken.RECUPERACION_PASSWORD);
        usado.revocar();
        when(tokenAuthRepository.findForUpdate(TokenHasher.hash("usado"), TipoToken.RECUPERACION_PASSWORD))
                .thenReturn(Optional.of(usado));

        assertThatThrownBy(() -> passwordRecoveryService.restablecer("usado", "nuevaPassword123"))
                .isInstanceOf(BusinessException.class)
                .satisfies(PasswordRecoveryServiceTest::assertTokenInvalido);

        assertThat(usuario.getPasswordHash()).isEqualTo("hash-original");
        verifyNoInteractions(passwordEncoder);
    }

    @Test
    void restablecerRechazaCuentaDesactivadaOEliminadaSinTocarSesiones() {
        Usuario desactivado = usuarioDePrueba();
        desactivado.desactivar();
        Usuario borrado = eliminado(usuarioDePrueba());
        when(tokenAuthRepository.findForUpdate(TokenHasher.hash("desactivado"), TipoToken.RECUPERACION_PASSWORD))
                .thenReturn(Optional.of(token(desactivado, "desactivado", Instant.now().plusSeconds(600),
                        TipoToken.RECUPERACION_PASSWORD)));
        when(tokenAuthRepository.findForUpdate(TokenHasher.hash("eliminado"), TipoToken.RECUPERACION_PASSWORD))
                .thenReturn(Optional.of(token(borrado, "eliminado", Instant.now().plusSeconds(600),
                        TipoToken.RECUPERACION_PASSWORD)));

        assertThatThrownBy(() -> passwordRecoveryService.restablecer("desactivado", "nuevaPassword123"))
                .isInstanceOf(BusinessException.class)
                .satisfies(PasswordRecoveryServiceTest::assertTokenInvalido);
        assertThatThrownBy(() -> passwordRecoveryService.restablecer("eliminado", "nuevaPassword123"))
                .isInstanceOf(BusinessException.class)
                .satisfies(PasswordRecoveryServiceTest::assertTokenInvalido);

        assertThat(desactivado.getPasswordHash()).isEqualTo("hash-original");
        assertThat(borrado.getPasswordHash()).isEqualTo("hash-original");
        verifyNoInteractions(passwordEncoder);
        verify(tokenAuthRepository, never()).findByUsuarioIdAndTipoAndRevokedAtIsNull(any(), any());
    }
}
