package cl.cloudcoffee.order_service.controller;

import java.net.URI;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.order_service.dto.PagoResponse;
import cl.cloudcoffee.order_service.dto.SimulacionPagoRequest;
import cl.cloudcoffee.order_service.service.SimulacionPagoService;
import cl.cloudcoffee.order_service.service.SimulacionPagoService.ResultadoSimulacion;
import jakarta.validation.Valid;

@RestController
@RequestMapping("/compras/{compraId}")
public class PagoSimuladoController {

    static final String IDEMPOTENCY_KEY = "Idempotency-Key";
    private static final java.util.regex.Pattern CLAVE_VALIDA = java.util.regex.Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");

    private final SimulacionPagoService simulacionPagoService;

    public PagoSimuladoController(SimulacionPagoService simulacionPagoService) {
        this.simulacionPagoService = simulacionPagoService;
    }

    /** 201 si abrió un intento nuevo; 200 si resolvió uno pendiente o repitió la misma clave. */
    @PostMapping("/pago/simulacion")
    public ResponseEntity<PagoResponse> simular(
            @PathVariable UUID compraId,
            @RequestHeader(IDEMPOTENCY_KEY) String clave,
            @Valid @RequestBody SimulacionPagoRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        if (!CLAVE_VALIDA.matcher(clave).matches()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/idempotency-key-invalida"),
                    "Idempotency-Key inválida",
                    "Idempotency-Key debe tener entre 1 y 100 caracteres alfanuméricos, '.', '_', ':' o '-'.");
        }
        ResultadoSimulacion resultado = simulacionPagoService.simular(
                usuario(jwt), compraId, clave, request.escenario());
        return ResponseEntity.status(resultado.creado() ? HttpStatus.CREATED : HttpStatus.OK)
                .body(PagoResponse.from(resultado.pago()));
    }

    @GetMapping("/pago")
    public PagoResponse consultar(@PathVariable UUID compraId, @AuthenticationPrincipal Jwt jwt) {
        return PagoResponse.from(simulacionPagoService.consultar(usuario(jwt), compraId));
    }

    // El dueño se toma solo del JWT firmado, nunca de parámetros del cliente.
    private static UUID usuario(Jwt jwt) {
        try {
            return UUID.fromString(jwt.getSubject());
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(HttpStatus.FORBIDDEN, URI.create("/problems/usuario-invalido"),
                    "Usuario inválido", "El token no identifica a un usuario válido.");
        }
    }
}
