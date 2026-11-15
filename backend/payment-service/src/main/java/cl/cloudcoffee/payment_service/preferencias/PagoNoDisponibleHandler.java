package cl.cloudcoffee.payment_service.preferencias;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import cl.cloudcoffee.errors.ApiProblems;
import jakarta.servlet.http.HttpServletRequest;

@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
class PagoNoDisponibleHandler {

    @ExceptionHandler(PagoNoDisponibleException.class)
    ResponseEntity<ProblemDetail> handle(PagoNoDisponibleException error, HttpServletRequest request) {
        ProblemDetail problem = ApiProblems.create(HttpStatus.SERVICE_UNAVAILABLE, error.getMessage(), request);
        problem.setTitle("Pago no disponible");
        problem.setProperty("code", error.getCode());
        var response = ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .header("Cache-Control", "no-store");
        if (error.getRetryAfter() != null) response.header("Retry-After", error.getRetryAfter().toString());
        return response.body(problem);
    }
}
