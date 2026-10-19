package cl.cloudcoffee.security;

import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

/**
 * INT2-65 alineado con INT2-50: autoriza al personal solo sobre la cafetería que
 * auth-service tiene persistida para él.
 *
 * Del JWT se usan solo la identidad ({@code sub}) y el rol. La asignación se
 * consulta en auth-service por {@link AsignacionesCafeteria}; el claim
 * {@value #CLAIM} del token es solo informativo para la UI y no autoriza nada.
 * Si la asignación no se puede comprobar, se niega el acceso (falla cerrado).
 * Ningún rol hereda permisos de personal por su nombre: SUPER_ADMIN tampoco.
 */
public class CafeteriaAccess {

    private static final Logger LOGGER = LoggerFactory.getLogger(CafeteriaAccess.class);

    /** Claim informativo que Auth agrega al JWT del personal; no se usa para autorizar. */
    public static final String CLAIM = "cafeteriaId";

    /** Roles cuya autorización depende de una cafetería asignada. */
    public static final Set<String> ROLES_PERSONAL = Set.of("CAJERO", "ADMIN_CAFETERIA");

    private final AsignacionesCafeteria asignaciones;

    public CafeteriaAccess(AsignacionesCafeteria asignaciones) {
        this.asignaciones = asignaciones;
    }

    public boolean puedeOperar(Authentication authentication, UUID cafeteriaId) {
        if (cafeteriaId == null || !(authentication instanceof JwtAuthenticationToken token)
                || !ROLES_PERSONAL.contains(token.getToken().getClaimAsString("role"))) {
            return false;
        }
        UUID usuarioId;
        try {
            usuarioId = UUID.fromString(token.getToken().getSubject());
        } catch (IllegalArgumentException exception) {
            return false;
        }
        try {
            Optional<UUID> asignada = asignaciones.cafeteriaDe(usuarioId);
            return asignada.isPresent() && asignada.get().equals(cafeteriaId);
        } catch (AsignacionNoVerificableException exception) {
            LOGGER.warn("Acceso denegado: no se pudo verificar la asignación de {}", usuarioId, exception);
            return false;
        }
    }

    public void verificar(Authentication authentication, UUID cafeteriaId) {
        if (!puedeOperar(authentication, cafeteriaId)) {
            throw new AccessDeniedException("El usuario no está autorizado para operar esta cafetería.");
        }
    }
}
