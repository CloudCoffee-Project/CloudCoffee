package cl.cloudcoffee.auth_service.service;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.auth_service.dto.LoginResponse;
import cl.cloudcoffee.auth_service.model.TipoToken;
import cl.cloudcoffee.auth_service.model.TokenAuth;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.TokenAuthRepository;
import cl.cloudcoffee.errors.BusinessException;

@Service
public class RefreshTokenService {

    private final TokenAuthRepository tokenAuthRepository;
    private final JwtTokenService jwtTokenService;
    private final Duration vigenciaRefreshToken;

    public RefreshTokenService(TokenAuthRepository tokenAuthRepository, JwtTokenService jwtTokenService,
            @Value("${cloudcoffee.jwt.refresh-token-ttl:P30D}") Duration vigenciaRefreshToken) {
        this.tokenAuthRepository = tokenAuthRepository;
        this.jwtTokenService = jwtTokenService;
        this.vigenciaRefreshToken = vigenciaRefreshToken;
    }

    @Transactional
    public LoginResponse renovar(String refreshTokenPlano) {
        TokenAuth tokenActual = tokenAuthRepository
                .findByTokenHashAndTipo(TokenHasher.hash(refreshTokenPlano), TipoToken.REFRESH)
                .filter(TokenAuth::estaVigente)
                .orElseThrow(RefreshTokenService::refreshTokenInvalido);

        // Rotación: el token presentado queda invalidado de inmediato, sin tocar
        // las sesiones de otros dispositivos del mismo usuario.
        tokenActual.revocar();

        Usuario usuario = tokenActual.getUsuario();
        String accessToken = jwtTokenService.emitir(usuario);

        String nuevoRefreshTokenPlano = TokenHasher.generarTokenPlano();
        TokenAuth nuevoRefreshToken = new TokenAuth(usuario, TokenHasher.hash(nuevoRefreshTokenPlano),
                Instant.now().plus(vigenciaRefreshToken), TipoToken.REFRESH);
        tokenAuthRepository.save(nuevoRefreshToken);

        return new LoginResponse(accessToken, nuevoRefreshTokenPlano);
    }

    private static BusinessException refreshTokenInvalido() {
        return new BusinessException(HttpStatus.UNAUTHORIZED, URI.create("/problems/refresh-token-invalido"),
                "Refresh token inválido", "El refresh token es inválido, expiró o ya fue utilizado.");
    }
}
