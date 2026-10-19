package cl.cloudcoffee.order_service.controller;

import java.net.URI;
import java.util.UUID;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
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
import cl.cloudcoffee.order_service.dto.SimularPagoRequest;
import cl.cloudcoffee.order_service.service.SimulacionPagoService;
import cl.cloudcoffee.order_service.service.SimulacionPagoService.Respuesta;
import jakarta.validation.Valid;

/**
 * Pago simulado de una compra (contrato INT2-50, #112). Gateway publica estas rutas
 * como {@code /v1/compras/{compraId}/pago}.
 */
@RestController
@RequestMapping("/compras/{compraId}/pago")
public class PagoSimuladoController {

    static final String IDEMPOTENCY_KEY = "Idempotency-Key";
    static final String IDEMPOTENCY_REPLAYED = "Idempotency-Replayed";

    private final SimulacionPagoService simulacionPagoService;

    public PagoSimuladoController(SimulacionPagoService simulacionPagoService) {
        this.simulacionPagoService = simulacionPagoService;
    }

    /** 201 con el pago creado; repetir la misma clave y cuerpo reproduce esa respuesta. */
    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> simular(
            @PathVariable UUID compraId,
            @RequestHeader(IDEMPOTENCY_KEY) String clave,
            @Valid @RequestBody SimularPagoRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        Respuesta respuesta = simulacionPagoService.simular(cliente(jwt), compraId, claveUuid(clave),
                request.getEscenario());
        ResponseEntity.BodyBuilder builder = ResponseEntity.status(respuesta.status())
                .cacheControl(CacheControl.noStore())
                .contentType(MediaType.APPLICATION_JSON);
        if (respuesta.location() != null) {
            builder.header(HttpHeaders.LOCATION, respuesta.location());
        }
        if (respuesta.replay()) {
            builder.header(IDEMPOTENCY_REPLAYED, "true");
        }
        return builder.body(respuesta.cuerpo());
    }

    /** Estado actual del pago; lectura sin efectos. */
    @GetMapping
    public ResponseEntity<PagoResponse> consultar(@PathVariable UUID compraId, @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PagoResponse.from(simulacionPagoService.consultar(cliente(jwt), compraId)));
    }

    // Solo CLIENTE; el dueño se toma del JWT firmado, nunca de parámetros del cliente.
    private static UUID cliente(Jwt jwt) {
        if (!"CLIENTE".equals(jwt.getClaimAsString("role"))) {
            throw new BusinessException(HttpStatus.FORBIDDEN, URI.create("/problems/rol-no-permitido"),
                    "Rol no permitido", "Solo un cliente puede pagar o consultar sus compras.", "ROL_NO_PERMITIDO");
        }
        try {
            return UUID.fromString(jwt.getSubject());
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(HttpStatus.FORBIDDEN, URI.create("/problems/usuario-invalido"),
                    "Usuario inválido", "El token no identifica a un usuario válido.", "USUARIO_INVALIDO");
        }
    }

    // Contrato: Idempotency-Key es un UUID por intención.
    private static UUID claveUuid(String clave) {
        try {
            UUID uuid = UUID.fromString(clave);
            if (uuid.toString().equalsIgnoreCase(clave)) {
                return uuid;
            }
        } catch (IllegalArgumentException ignored) {
            // Se responde 400 abajo.
        }
        throw new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/idempotency-key-invalida"),
                "Idempotency-Key inválida", "Idempotency-Key debe ser un UUID.", "IDEMPOTENCY_KEY_INVALIDA");
    }
}
