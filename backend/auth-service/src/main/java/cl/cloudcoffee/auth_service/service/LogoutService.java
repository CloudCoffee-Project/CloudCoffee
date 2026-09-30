package cl.cloudcoffee.auth_service.service;

import java.net.URI;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.auth_service.model.TipoToken;
import cl.cloudcoffee.auth_service.model.TokenAuth;
import cl.cloudcoffee.auth_service.repository.TokenAuthRepository;
import cl.cloudcoffee.errors.BusinessException;

@Service
public class LogoutService {

    private final TokenAuthRepository tokenAuthRepository;

    public LogoutService(TokenAuthRepository tokenAuthRepository) {
        this.tokenAuthRepository = tokenAuthRepository;
    }

    @Transactional
    public void cerrarSesion(String usuarioId, String refreshTokenPlano) {
        TokenAuth token = tokenAuthRepository
                .findForUpdate(TokenHasher.hash(refreshTokenPlano), TipoToken.REFRESH)
                .filter(actual -> actual.getUsuario().getId().toString().equals(usuarioId))
                .orElseThrow(() -> new BusinessException(HttpStatus.UNAUTHORIZED,
                        URI.create("/problems/refresh-token-invalido"), "Refresh token inválido",
                        "El refresh token no pertenece al usuario autenticado o es inválido."));

        // El mismo bloqueo se usa al renovar para impedir reutilizaciones concurrentes.
        // Conservar revokedAt hace que repetir el logout no cambie el estado de la sesión.
        if (token.getRevokedAt() == null) {
            token.revocar();
        }
    }
}
