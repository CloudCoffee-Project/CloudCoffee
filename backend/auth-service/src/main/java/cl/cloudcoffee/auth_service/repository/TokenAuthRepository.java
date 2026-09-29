package cl.cloudcoffee.auth_service.repository;

import cl.cloudcoffee.auth_service.model.TipoToken;
import cl.cloudcoffee.auth_service.model.TokenAuth;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface TokenAuthRepository extends JpaRepository<TokenAuth, UUID> {
    Optional<TokenAuth> findByTokenHash(String tokenHash);
    Optional<TokenAuth> findByTokenHashAndTipo(String tokenHash, TipoToken tipo);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from TokenAuth t where t.tokenHash = :tokenHash and t.tipo = :tipo")
    Optional<TokenAuth> findForUpdate(@Param("tokenHash") String tokenHash, @Param("tipo") TipoToken tipo);
    List<TokenAuth> findByUsuarioIdAndRevokedAtIsNull(UUID usuarioId);
    List<TokenAuth> findByUsuarioIdAndTipoAndRevokedAtIsNull(UUID usuarioId, TipoToken tipo);
}

