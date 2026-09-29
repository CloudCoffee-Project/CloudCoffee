package cl.cloudcoffee.auth_service.service;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;

import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.auth_service.messaging.AuthEventPublisher;
import cl.cloudcoffee.auth_service.model.TipoToken;
import cl.cloudcoffee.auth_service.model.TokenAuth;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.TokenAuthRepository;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.errors.BusinessException;

@Service
public class PasswordRecoveryService {

    private static final Duration VIGENCIA_TOKEN = Duration.ofHours(1);

    private final UsuarioRepository usuarioRepository;
    private final TokenAuthRepository tokenAuthRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuthEventPublisher eventPublisher;

    public PasswordRecoveryService(UsuarioRepository usuarioRepository, TokenAuthRepository tokenAuthRepository,
            PasswordEncoder passwordEncoder, AuthEventPublisher eventPublisher) {
        this.usuarioRepository = usuarioRepository;
        this.tokenAuthRepository = tokenAuthRepository;
        this.passwordEncoder = passwordEncoder;
        this.eventPublisher = eventPublisher;
    }

    @Transactional
    public void solicitar(String email, String traceId) {
        usuarioRepository.findByEmailIgnoreCase(email.trim().toLowerCase(Locale.ROOT))
                .filter(usuario -> usuario.isActivo() && !usuario.isEliminado())
                .ifPresent(usuario -> {
                    tokenAuthRepository.findByUsuarioIdAndTipoAndRevokedAtIsNull(
                            usuario.getId(), TipoToken.RECUPERACION_PASSWORD).forEach(TokenAuth::revocar);

                    String tokenPlano = TokenHasher.generarTokenPlano();
                    Instant expiresAt = Instant.now().plus(VIGENCIA_TOKEN);
                    tokenAuthRepository.save(new TokenAuth(usuario, TokenHasher.hash(tokenPlano),
                            expiresAt, TipoToken.RECUPERACION_PASSWORD));
                    eventPublisher.publishSolicitudRecuperacionPassword(usuario.getId().toString(),
                            usuario.getEmail(), tokenPlano, expiresAt, traceId);
                });
    }

    @Transactional
    public void restablecer(String tokenPlano, String nuevaPassword) {
        TokenAuth token = tokenAuthRepository.findForUpdate(
                        TokenHasher.hash(tokenPlano.trim()), TipoToken.RECUPERACION_PASSWORD)
                .filter(TokenAuth::estaVigente)
                .orElseThrow(PasswordRecoveryService::tokenInvalido);

        Usuario usuario = token.getUsuario();
        if (!usuario.isActivo() || usuario.isEliminado()) {
            throw tokenInvalido();
        }

        usuario.actualizarPasswordHash(passwordEncoder.encode(nuevaPassword));
        tokenAuthRepository.findByUsuarioIdAndTipoAndRevokedAtIsNull(
                usuario.getId(), TipoToken.RECUPERACION_PASSWORD).forEach(TokenAuth::revocar);
        tokenAuthRepository.findByUsuarioIdAndTipoAndRevokedAtIsNull(
                usuario.getId(), TipoToken.REFRESH).forEach(TokenAuth::revocar);
    }

    private static BusinessException tokenInvalido() {
        return new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/token-recuperacion-invalido"),
                "Token inválido", "El token de recuperación es inválido, expiró o ya fue utilizado.");
    }
}
