package cl.cloudcoffee.payment_service.web;

import cl.cloudcoffee.errors.ApiProblems;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/** Fail closed until INT2-112 provides signature verification and durable inbox processing. */
@RestController
public class PaymentWebhookController {
    @PostMapping("/payments/webhooks/mercadopago")
    ResponseEntity<ProblemDetail> receive(HttpServletRequest request) {
        ProblemDetail problem = ApiProblems.create(HttpStatus.SERVICE_UNAVAILABLE,
                "La recepción de pagos externos todavía no está habilitada.", request);
        problem.setProperty("code", "PAYMENT_NOT_ENABLED");
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .header("Cache-Control", "no-store")
                .header("Retry-After", "2")
                .body(problem);
    }
}
