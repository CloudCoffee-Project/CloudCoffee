package cl.cloudcoffee.auth_service.service;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;

import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.auth_service.dto.LoginResponse;
import cl.cloudcoffee.auth_service.model.TipoToken;
import cl.cloudcoffee.auth_service.model.TokenAuth;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.TokenAuthRepository;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.errors.BusinessException;

@Service
public class LoginService {

    private static final Duration VIGENCIA_REFRESH_TOKEN = Duration.ofDays(30);

    private final UsuarioRepository usuarioRepository;
    private final PasswordEncoder passwordEncoder;
    private final TokenAuthRepository tokenAuthRepository;
    private final JwtTokenService jwtTokenService;

    public LoginService(UsuarioRepository usuarioRepository, PasswordEncoder passwordEncoder,
            TokenAuthRepository tokenAuthRepository, JwtTokenService jwtTokenService) {
        this.usuarioRepository = usuarioRepository;
        this.passwordEncoder = passwordEncoder;
        this.tokenAuthRepository = tokenAuthRepository;
        this.jwtTokenService = jwtTokenService;
    }

    @Transactional
    public LoginResponse iniciarSesion(String email, String password) {
        Usuario usuario = usuarioRepository.findByEmail(email)
                .filter(u -> passwordEncoder.matches(password, u.getPasswordHash()))
                .orElseThrow(LoginService::credencialesInvalidas);

        if (!usuario.isVerificado()) {
            throw new BusinessException(HttpStatus.FORBIDDEN, URI.create("/problems/cuenta-no-verificada"),
                    "Cuenta no verificada", "Debes verificar tu correo electrónico antes de iniciar sesión.");
        }

        String accessToken = jwtTokenService.emitir(usuario);

        // Un token nuevo por sesión/dispositivo: no se revocan los refresh tokens
        // vigentes de otras sesiones activas del mismo usuario.
        String refreshTokenPlano = TokenHasher.generarTokenPlano();
        TokenAuth refreshToken = new TokenAuth(usuario, TokenHasher.hash(refreshTokenPlano),
                Instant.now().plus(VIGENCIA_REFRESH_TOKEN), TipoToken.REFRESH);
        tokenAuthRepository.save(refreshToken);

        return new LoginResponse(accessToken, refreshTokenPlano);
    }

    private static BusinessException credencialesInvalidas() {
        return new BusinessException(HttpStatus.UNAUTHORIZED, URI.create("/problems/credenciales-invalidas"),
                "Credenciales inválidas", "El correo o la contraseña son incorrectos.");
    }
}
