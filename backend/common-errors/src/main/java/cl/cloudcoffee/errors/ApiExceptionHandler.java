package cl.cloudcoffee.errors;

import java.util.List;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.ServletWebRequest;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

@RestControllerAdvice
public class ApiExceptionHandler extends ResponseEntityExceptionHandler {

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<Object> handleBusiness(BusinessException exception, WebRequest request) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(exception.getStatus(), exception.getMessage());
        problem.setType(exception.getType());
        problem.setTitle(exception.getTitle());
        return createResponseEntity(problem, new HttpHeaders(), exception.getStatus(), request);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Object> handleUnexpected(Exception exception, WebRequest request) {
        logger.error("Error no controlado al procesar una solicitud", exception);
        return createResponseEntity(null, new HttpHeaders(), HttpStatus.INTERNAL_SERVER_ERROR, request);
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException exception,
            HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, ApiProblems.defaultDetail(status));
        List<ValidationError> errors = exception.getBindingResult().getFieldErrors().stream()
                .map(error -> new ValidationError(error.getField(), error.getDefaultMessage()))
                .toList();
        // No se incluyen valores rechazados: podrían contener contraseñas o tokens.
        problem.setProperty("errors", errors);
        return handleExceptionInternal(exception, problem, headers, status, request);
    }

    @Override
    protected ResponseEntity<Object> handleExceptionInternal(Exception exception, Object body,
            HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        if (status.is5xxServerError()) {
            logger.error("Error interno al procesar una solicitud MVC", exception);
        }
        return super.handleExceptionInternal(exception, body, headers, status, request);
    }

    @Override
    protected ResponseEntity<Object> createResponseEntity(Object body, HttpHeaders headers,
            HttpStatusCode status, WebRequest request) {
        ProblemDetail problem = body instanceof ProblemDetail existing
                ? existing : ProblemDetail.forStatus(status);
        problem.setStatus(status.value());
        if (status.is5xxServerError()) {
            // Se descartan también extensiones de errores internos para evitar filtrar información.
            problem = ProblemDetail.forStatusAndDetail(status, ApiProblems.defaultDetail(status));
        } else if (problem.getDetail() == null) {
            problem.setDetail(ApiProblems.defaultDetail(status));
        }
        ApiProblems.complete(problem, ((ServletWebRequest) request).getRequest());
        HttpHeaders responseHeaders = new HttpHeaders();
        responseHeaders.putAll(headers);
        responseHeaders.setContentType(MediaType.APPLICATION_PROBLEM_JSON);
        return new ResponseEntity<>(problem, responseHeaders, status);
    }

    public record ValidationError(String field, String message) {
    }
}
