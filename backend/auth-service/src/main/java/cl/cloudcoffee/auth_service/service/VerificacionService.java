package cl.cloudcoffee.auth_service.service;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.auth_service.dto.VerificacionCorreoResponse;
import cl.cloudcoffee.auth_service.messaging.AuthEventPublisher;
import cl.cloudcoffee.auth_service.model.TipoToken;
import cl.cloudcoffee.auth_service.model.TokenAuth;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.TokenAuthRepository;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.errors.BusinessException;

@Service
public class VerificacionService {

    private static final Duration VIGENCIA_TOKEN = Duration.ofHours(24);

    private final UsuarioRepository usuarioRepository;
    private final TokenAuthRepository tokenAuthRepository;
    private final AuthEventPublisher eventPublisher;

    public VerificacionService(UsuarioRepository usuarioRepository, TokenAuthRepository tokenAuthRepository,
            AuthEventPublisher eventPublisher) {
        this.usuarioRepository = usuarioRepository;
        this.tokenAuthRepository = tokenAuthRepository;
        this.eventPublisher = eventPublisher;
    }

    @Transactional
    public void solicitarVerificacion(Usuario usuario, String traceId) {
        tokenAuthRepository.findByUsuarioIdAndTipoAndRevokedAtIsNull(usuario.getId(), TipoToken.VERIFICACION_CORREO)
                .forEach(TokenAuth::revocar);

        String tokenPlano = TokenHasher.generarTokenPlano();
        Instant expiresAt = Instant.now().plus(VIGENCIA_TOKEN);
        TokenAuth token = new TokenAuth(usuario, TokenHasher.hash(tokenPlano), expiresAt, TipoToken.VERIFICACION_CORREO);
        tokenAuthRepository.save(token);

        eventPublisher.publishSolicitudVerificacionCorreo(
                usuario.getId().toString(), usuario.getEmail(), tokenPlano, expiresAt, traceId);
    }

    @Transactional
    public VerificacionCorreoResponse verificarCorreo(String tokenPlano) {
        TokenAuth token = tokenAuthRepository
                .findByTokenHashAndTipo(TokenHasher.hash(tokenPlano), TipoToken.VERIFICACION_CORREO)
                .filter(TokenAuth::estaVigente)
                .orElseThrow(VerificacionService::tokenInvalido);

        Usuario usuario = token.getUsuario();
        usuario.verificar();
        token.revocar();

        return VerificacionCorreoResponse.from(usuario);
    }

    @Transactional
    public void reenviarVerificacion(String email, String traceId) {
        Usuario usuario = usuarioRepository.findByEmail(email)
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND,
                        URI.create("/problems/usuario-no-encontrado"), "Usuario no encontrado",
                        "No existe una cuenta asociada a este correo electrónico."));

        if (usuario.isVerificado()) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/correo-ya-verificado"),
                    "Correo ya verificado", "La cuenta ya fue verificada.");
        }

        solicitarVerificacion(usuario, traceId);
    }

    private static BusinessException tokenInvalido() {
        return new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/token-invalido"),
                "Token inválido", "El token de verificación es inválido o expiró.");
    }
}
