package cl.cloudcoffee.security;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Autentica llamadas entre servicios a {@code /internal/servicios/**} con un token
 * compartido (encabezado {@value #HEADER}). Sin token configurado no autentica a
 * nadie: esas rutas responden 401 (falla cerrado). Un JWT de usuario nunca obtiene
 * el rol {@value #ROLE}, así que recibe 403.
 */
public class InternalServiceAuthenticationFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Internal-Service-Token";
    public static final String PATH_PREFIX = "/internal/servicios/";
    public static final String ROLE = "INTERNAL_SERVICE";

    /** Largo mínimo para aceptar el token configurado. */
    static final int LARGO_MINIMO = 32;

    private final byte[] token;

    public InternalServiceAuthenticationFilter(String token) {
        this.token = token == null || token.length() < LARGO_MINIMO ? null : token.getBytes(StandardCharsets.UTF_8);
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith(request.getContextPath() + PATH_PREFIX);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String recibido = request.getHeader(HEADER);
        if (token != null && recibido != null
                && MessageDigest.isEqual(token, recibido.getBytes(StandardCharsets.UTF_8))) {
            var autenticacion = new UsernamePasswordAuthenticationToken("internal-service", null,
                    List.of(new SimpleGrantedAuthority("ROLE_" + ROLE)));
            var contexto = SecurityContextHolder.createEmptyContext();
            contexto.setAuthentication(autenticacion);
            SecurityContextHolder.setContext(contexto);
        }
        chain.doFilter(request, response);
    }
}
