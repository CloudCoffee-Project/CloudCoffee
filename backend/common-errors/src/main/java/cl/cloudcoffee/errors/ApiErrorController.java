package cl.cloudcoffee.errors;

import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.webmvc.error.ErrorController;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Cubre sendError y errores del contenedor que no atraviesan el advice MVC. */
@RestController
public class ApiErrorController implements ErrorController {

    private static final Logger log = LoggerFactory.getLogger(ApiErrorController.class);

    @RequestMapping("${spring.web.error.path:${error.path:/error}}")
    public ResponseEntity<ProblemDetail> error(HttpServletRequest request) {
        HttpStatusCode status = ApiProblems.errorStatus(request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE));
        if (status.is5xxServerError()
                && request.getAttribute(RequestDispatcher.ERROR_EXCEPTION) instanceof Throwable exception) {
            log.error("Error del contenedor al procesar una solicitud", exception);
        }
        ProblemDetail problem = ApiProblems.create(status, ApiProblems.defaultDetail(status), request);
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_PROBLEM_JSON).body(problem);
    }
}
