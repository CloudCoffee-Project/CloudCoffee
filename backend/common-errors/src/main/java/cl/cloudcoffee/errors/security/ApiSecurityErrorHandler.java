package cl.cloudcoffee.errors.security;

import java.io.IOException;

import cl.cloudcoffee.errors.ApiProblems;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import tools.jackson.databind.json.JsonMapper;

/** Adaptador para los filtros de seguridad; se conecta explícitamente en SecurityFilterChain. */
public final class ApiSecurityErrorHandler
        implements AuthenticationEntryPoint, AccessDeniedHandler, AuthenticationFailureHandler {

    private final JsonMapper mapper;

    public ApiSecurityErrorHandler(JsonMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response,
            AuthenticationException exception) throws IOException {
        // Challenge del esquema JWT Bearer previsto para CloudCoffee.
        response.setHeader(HttpHeaders.WWW_AUTHENTICATE, "Bearer");
        write(request, response, HttpStatus.UNAUTHORIZED);
    }

    @Override
    public void onAuthenticationFailure(HttpServletRequest request, HttpServletResponse response,
            AuthenticationException exception) throws IOException {
        commence(request, response, exception);
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response,
            AccessDeniedException exception) throws IOException {
        write(request, response, HttpStatus.FORBIDDEN);
    }

    private void write(HttpServletRequest request, HttpServletResponse response, HttpStatus status)
            throws IOException {
        if (response.isCommitted()) {
            return;
        }
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        mapper.writeValue(response.getOutputStream(),
                ApiProblems.create(status, ApiProblems.defaultDetail(status), request));
    }
}
