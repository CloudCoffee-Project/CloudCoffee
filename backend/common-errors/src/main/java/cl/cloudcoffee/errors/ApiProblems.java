package cl.cloudcoffee.errors;

import java.net.URI;
import java.time.Instant;

import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;

/** Único lugar donde se completan los campos comunes del contrato HTTP. */
public final class ApiProblems {

    private ApiProblems() {
    }

    public static ProblemDetail create(HttpStatusCode status, String detail, HttpServletRequest request) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        return complete(problem, request);
    }

    public static ProblemDetail complete(ProblemDetail problem, HttpServletRequest request) {
        // Spring 7 deja type nulo por defecto; CloudCoffee lo exige explícito.
        if (problem.getType() == null) {
            problem.setType(URI.create("about:blank"));
        }
        if (problem.getTitle() == null) {
            problem.setTitle("Error HTTP");
        }
        // El error dispatch utiliza /error; el cliente necesita la ruta original.
        Object originalUri = request.getAttribute(RequestDispatcher.ERROR_REQUEST_URI);
        String path = originalUri instanceof String uri ? uri : request.getRequestURI();
        problem.setInstance(URI.create(path));
        problem.setProperty("timestamp", Instant.now().toString());
        return problem;
    }

    public static String defaultDetail(HttpStatusCode status) {
        return switch (status.value()) {
            case 400 -> "La solicitud contiene datos inválidos.";
            case 401 -> "Se requiere autenticación válida para acceder a este recurso.";
            case 403 -> "No tienes permiso para acceder a este recurso.";
            case 404 -> "El recurso solicitado no existe.";
            case 405 -> "El método HTTP no está permitido para este recurso.";
            case 406 -> "El formato de respuesta solicitado no está disponible.";
            case 409 -> "La operación entra en conflicto con el estado actual del recurso.";
            case 415 -> "El tipo de contenido de la solicitud no está soportado.";
            default -> status.is5xxServerError()
                    ? "Ocurrió un error interno. Inténtalo nuevamente más tarde."
                    : "No se pudo procesar la solicitud.";
        };
    }

    public static HttpStatusCode errorStatus(Object value) {
        return value instanceof Integer code && code >= 400 && code <= 599
                ? HttpStatusCode.valueOf(code) : HttpStatus.INTERNAL_SERVER_ERROR;
    }
}
