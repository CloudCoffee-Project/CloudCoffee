package cl.cloudcoffee.auth_service.service;

import java.time.Duration;
import java.time.Instant;
import java.util.EnumSet;
import java.util.Objects;
import java.util.Set;

import cl.cloudcoffee.auth_service.model.Rol;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.AsignacionCafeteriaRepository;
import cl.cloudcoffee.security.CafeteriaAccess;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.stereotype.Service;

/** Firma access tokens para un usuario previamente autenticado por el flujo de login. */
@Service
public class JwtTokenService {
    private static final Set<Rol> ROLES_CON_CAFETERIA = EnumSet.of(Rol.CAJERO, Rol.ADMIN_CAFETERIA);

    private final JwtEncoder encoder;
    private final AsignacionCafeteriaRepository asignaciones;
    private final Duration ttl;

    public JwtTokenService(JwtEncoder encoder, AsignacionCafeteriaRepository asignaciones,
            @Value("${cloudcoffee.jwt.access-token-ttl:PT15M}") Duration ttl) {
        if (ttl.isZero() || ttl.isNegative()) {
            throw new IllegalArgumentException("JWT access-token-ttl must be positive");
        }
        this.encoder = encoder;
        this.asignaciones = asignaciones;
        this.ttl = ttl;
    }

    public String emitir(Usuario usuario) {
        Objects.requireNonNull(usuario.getId(), "JWT requires a persisted user");
        Objects.requireNonNull(usuario.getRol(), "JWT requires a user role");
        Instant now = Instant.now();
        JwtClaimsSet.Builder claims = JwtClaimsSet.builder()
                .subject(usuario.getId().toString())
                .issuedAt(now).expiresAt(now.plus(ttl))
                .claim("role", usuario.getRol().name());
        // INT2-65: la cafetería sale de la asignación persistida, nunca del cliente.
        // El personal sin asignación recibe un token sin cafeteriaId.
        if (ROLES_CON_CAFETERIA.contains(usuario.getRol())) {
            asignaciones.findById(usuario.getId()).ifPresent(asignacion ->
                    claims.claim(CafeteriaAccess.CLAIM, asignacion.getCafeteriaId().toString()));
        }
        return encoder.encode(JwtEncoderParameters.from(
                JwsHeader.with(SignatureAlgorithm.RS256).build(), claims.build())).getTokenValue();
    }
}
