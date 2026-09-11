package cl.cloudcoffee.errors.security;

import cl.cloudcoffee.errors.ApiProblems;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
public class ApiSecurityExceptionHandler {

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<ProblemDetail> authentication(AuthenticationException exception,
            HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .header(HttpHeaders.WWW_AUTHENTICATE, "Bearer")
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(ApiProblems.create(HttpStatus.UNAUTHORIZED,
                        ApiProblems.defaultDetail(HttpStatus.UNAUTHORIZED), request));
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ProblemDetail> accessDenied(AccessDeniedException exception,
            HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(ApiProblems.create(HttpStatus.FORBIDDEN,
                        ApiProblems.defaultDetail(HttpStatus.FORBIDDEN), request));
    }
}
