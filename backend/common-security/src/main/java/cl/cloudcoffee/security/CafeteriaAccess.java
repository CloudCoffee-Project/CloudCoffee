package cl.cloudcoffee.security;

import java.util.Set;
import java.util.UUID;

import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

/**
 * INT2-65: autoriza al personal solo sobre la cafetería asignada en Auth.
 *
 * La cafetería y el rol se leen exclusivamente del JWT firmado por Auth; nunca
 * de encabezados, parámetros ni cuerpos enviados por el frontend.
 */
public class CafeteriaAccess {

    /** Claim que Auth agrega al JWT del personal con cafetería asignada. */
    public static final String CLAIM = "cafeteriaId";

    /** Roles cuya autorización depende de una cafetería asignada. */
    public static final Set<String> ROLES_PERSONAL = Set.of("CAJERO", "ADMIN_CAFETERIA");

    static final String SUPER_ADMIN = "SUPER_ADMIN";

    public boolean puedeOperar(Authentication authentication, UUID cafeteriaId) {
        if (cafeteriaId == null || !(authentication instanceof JwtAuthenticationToken token)) {
            return false;
        }
        String role = token.getToken().getClaimAsString("role");
        if (SUPER_ADMIN.equals(role)) {
            return true;
        }
        return ROLES_PERSONAL.contains(role)
                && cafeteriaId.toString().equals(token.getToken().getClaimAsString(CLAIM));
    }

    public void verificar(Authentication authentication, UUID cafeteriaId) {
        if (!puedeOperar(authentication, cafeteriaId)) {
            throw new AccessDeniedException("El usuario no está autorizado para operar esta cafetería.");
        }
    }
}
