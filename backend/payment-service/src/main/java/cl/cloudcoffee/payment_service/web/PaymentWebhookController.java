package cl.cloudcoffee.payment_service.web;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import cl.cloudcoffee.payment_service.pagos.RecepcionWebhook;
import cl.cloudcoffee.payment_service.pagos.RecepcionWebhook.Recepcion;

/**
 * Webhook público de Mercado Pago (Gateway: {@code POST /v1/payments/webhooks/mercadopago}). No usa JWT: se
 * autentica con la firma del proveedor. 202 = notificación nueva guardada; 200 = ya estaba guardada.
 */
@RestController
public class PaymentWebhookController {

    private final RecepcionWebhook recepcion;

    public PaymentWebhookController(RecepcionWebhook recepcion) {
        this.recepcion = recepcion;
    }

    @PostMapping("/payments/webhooks/mercadopago")
    ResponseEntity<Void> receive(@RequestParam(name = "data.id", required = false) String dataId,
            @RequestParam(name = "type", required = false) String type,
            @RequestHeader(name = "x-signature", required = false) String signature,
            @RequestHeader(name = "x-request-id", required = false) String requestId,
            @RequestBody(required = false) String body) {
        Recepcion resultado = recepcion.recibir(dataId, type, signature, requestId, body);
        return ResponseEntity.status(resultado == Recepcion.NUEVA ? HttpStatus.ACCEPTED : HttpStatus.OK)
                .header("Cache-Control", "no-store").build();
    }
}
