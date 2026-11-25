package cl.cloudcoffee.auth_service.service;

import java.net.URI;
import java.util.regex.Pattern;

import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.auth_service.dto.ActivacionResponse;
import cl.cloudcoffee.auth_service.model.TipoToken;
import cl.cloudcoffee.auth_service.model.TokenAuth;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.TokenAuthRepository;
import cl.cloudcoffee.errors.BusinessException;

/**
 * {@code POST /auth/activacion} (contrato INT2-109): la persona invitada define su contraseña con el
 * token de un solo uso del correo. Nadie más conoce ni fija esa contraseña.
 */
@Service
public class ActivacionCuentaService {

    private static final Pattern FORMATO_TOKEN = Pattern.compile("[A-Za-z0-9_-]{43}");

    private final TokenAuthRepository tokens;
    private final PasswordEncoder passwordEncoder;

    public ActivacionCuentaService(TokenAuthRepository tokens, PasswordEncoder passwordEncoder) {
        this.tokens = tokens;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional
    public ActivacionResponse activar(String tokenPlano, String password) {
        if (tokenPlano == null || !FORMATO_TOKEN.matcher(tokenPlano).matches()) throw tokenInvalido();
        // El bloqueo serializa dos activaciones con el mismo token: solo la primera lo consume.
        TokenAuth token = tokens.findForUpdate(TokenHasher.hash(tokenPlano), TipoToken.ACTIVACION_CUENTA)
                .filter(TokenAuth::estaVigente)
                .orElseThrow(ActivacionCuentaService::tokenInvalido);
        Usuario usuario = token.getUsuario();
        if (usuario.isEliminado() || !usuario.isActivo()) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/estado-invalido"),
                    "Estado inválido", "La cuenta está desactivada o fue dada de baja.", "ESTADO_INVALIDO");
        }
        if (usuario.isVerificado()) throw tokenInvalido();
        usuario.activarConPassword(passwordEncoder.encode(password));
        tokens.findByUsuarioIdAndTipoAndRevokedAtIsNull(usuario.getId(), TipoToken.ACTIVACION_CUENTA)
                .forEach(TokenAuth::revocar);
        return new ActivacionResponse(usuario.getId(), usuario.getEmail(), usuario.getRol().name());
    }

    private static BusinessException tokenInvalido() {
        return new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/token-activacion-invalido"),
                "Token de activación inválido", "El enlace de activación es inválido, expiró o ya fue utilizado.",
                "TOKEN_ACTIVACION_INVALIDO");
    }
}
