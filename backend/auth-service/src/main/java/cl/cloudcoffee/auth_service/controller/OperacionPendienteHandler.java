package cl.cloudcoffee.auth_service.controller;

import java.net.URI;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import cl.cloudcoffee.auth_service.service.OperacionPendienteException;
import cl.cloudcoffee.errors.ApiProblems;
import jakarta.servlet.http.HttpServletRequest;

/** 503 OPERACION_PENDIENTE del contrato INT2-109: una dependencia no respondió y no se cambió nada. */
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
class OperacionPendienteHandler {

    @ExceptionHandler(OperacionPendienteException.class)
    ResponseEntity<ProblemDetail> handle(OperacionPendienteException error, HttpServletRequest request) {
        ProblemDetail problem = ApiProblems.create(HttpStatus.SERVICE_UNAVAILABLE, error.getMessage(), request);
        problem.setType(URI.create("/problems/operacion-pendiente"));
        problem.setTitle("Operación pendiente");
        problem.setProperty("code", "OPERACION_PENDIENTE");
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .header("Cache-Control", "no-store")
                .header("Retry-After", "2")
                .body(problem);
    }
}
