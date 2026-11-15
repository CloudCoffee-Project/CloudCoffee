package cl.cloudcoffee.payment_service.preferencias;

import java.util.UUID;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * API interna de preferencias (contrato Payment 2.0.0). Solo X-Internal-Service-Token: la seguridad exige el
 * rol de servicio en /internal/servicios/** y Gateway no publica estas rutas. Monto, compra, ítems y canal
 * llegan de Order; las URLs de retorno salen exclusivamente de la configuración.
 */
@RestController
@RequestMapping("/internal/servicios/payments/preferencias")
public class PreferenciasInternasController {

    private final PreferenciaService preferencias;
    private final JsonMapper json = JsonMapper.builder().build();

    public PreferenciasInternasController(PreferenciaService preferencias) {
        this.preferencias = preferencias;
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<PreferenciaResponse> crear(
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody String cuerpo) {
        JsonNode nodo;
        try {
            nodo = json.readTree(cuerpo);
        } catch (JacksonException error) {
            throw SolicitudPreferencia.invalida("El cuerpo no es un JSON válido.");
        }
        var resultado = preferencias.crear(idempotencyKey, nodo);
        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .header("Idempotency-Replayed", Boolean.toString(resultado.repetida()))
                .body(resultado.preferencia());
    }

    @GetMapping(path = "/{compraId}", produces = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<PreferenciaResponse> consultar(@PathVariable String compraId) {
        UUID compra;
        try {
            compra = UUID.fromString(compraId);
        } catch (IllegalArgumentException error) {
            throw SolicitudPreferencia.invalida("compraId debe ser un UUID.");
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(preferencias.consultar(compra));
    }
}
