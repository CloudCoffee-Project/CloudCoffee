package cl.cloudcoffee.order_service.controller;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.order_service.creacion.CreacionCompraService;
import cl.cloudcoffee.order_service.dto.QrRetiroResponse;
import cl.cloudcoffee.order_service.service.RetiroService;
import java.net.URI;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.CacheControl;
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
import org.springframework.web.bind.annotation.RestController;

@RestController
public class RetiroController {
    private final RetiroService retiro;

    public RetiroController(RetiroService retiro) {
        this.retiro = retiro;
    }

    @PostMapping("/orders/{ordenId}/listo")
    public ResponseEntity<String> preparar(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID ordenId,
            @RequestHeader(name = "Idempotency-Key", required = false) String clave,
            @RequestBody(required = false) String cuerpo) {
        UUID usuario = usuario(jwt, Set.of("CAJERO"));
        UUID key;
        try {
            key = CreacionCompraService.uuid(clave);
        } catch (BusinessException invalid) {
            throw error("IDEMPOTENCY_KEY_INVALIDA", "Idempotency-Key debe ser un UUID.");
        }
        if (cuerpo != null && !cuerpo.isBlank()) throw error("SOLICITUD_INVALIDA", "La preparación no admite cuerpo.");
        var respuesta = retiro.preparar(usuario, ordenId, key);
        var builder = ResponseEntity.status(respuesta.status()).cacheControl(CacheControl.noStore())
                .contentType(respuesta.status() == 200 ? MediaType.APPLICATION_JSON : MediaType.APPLICATION_PROBLEM_JSON);
        if (respuesta.replay()) builder.header("Idempotency-Replayed", "true");
        return builder.body(respuesta.cuerpo());
    }

    @GetMapping("/orders/{ordenId}/qr")
    public ResponseEntity<QrRetiroResponse> consultar(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID ordenId) {
        UUID usuario = usuario(jwt, Set.of("CLIENTE", "CAJERO"));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(retiro.consultar(usuario, jwt.getClaimAsString("role"), ordenId));
    }

    private static UUID usuario(Jwt jwt, Set<String> roles) {
        if (!roles.contains(jwt.getClaimAsString("role"))) {
            throw new BusinessException(HttpStatus.FORBIDDEN, URI.create("/problems/rol-no-permitido"),
                    "Rol no permitido", "El rol no está autorizado para esta operación.", "ROL_NO_PERMITIDO");
        }
        return CreacionCompraService.uuid(jwt.getSubject());
    }

    private static BusinessException error(String code, String detail) {
        return new BusinessException(HttpStatus.BAD_REQUEST,
                URI.create("/problems/" + code.toLowerCase(java.util.Locale.ROOT).replace('_', '-')),
                "Solicitud inválida", detail, code);
    }
}
