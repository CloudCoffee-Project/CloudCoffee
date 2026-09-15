package cl.cloudcoffee.auth_service.repository;

import cl.cloudcoffee.auth_service.model.TokenAuth;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface TokenAuthRepository extends JpaRepository<TokenAuth, UUID> {
    Optional<TokenAuth> findByTokenHash(String tokenHash);
    List<TokenAuth> findByUsuarioIdAndRevokedAtIsNull(UUID usuarioId);
}


