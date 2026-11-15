package cl.cloudcoffee.order_service.controller;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.order_service.creacion.CreacionCompraService;
import cl.cloudcoffee.order_service.revision.RevisionCompraService;
import java.net.URI;
import java.util.UUID;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
public class RevisionCompraController {
    private final RevisionCompraService revisiones;
    public RevisionCompraController(RevisionCompraService revisiones) { this.revisiones = revisiones; }

    @PostMapping("/compras/{id}/confirmar")
    public ResponseEntity<String> confirmarCompra(@AuthenticationPrincipal Jwt jwt, @PathVariable String id,
            @RequestHeader(name = "Idempotency-Key", required = false) String clave, @RequestBody(required = false) String cuerpo) {
        return ejecutar(jwt, id, clave, cuerpo, false, true);
    }
    @PostMapping("/compras/{id}/cancelar")
    public ResponseEntity<String> cancelarCompra(@AuthenticationPrincipal Jwt jwt, @PathVariable String id,
            @RequestHeader(name = "Idempotency-Key", required = false) String clave, @RequestBody(required = false) String cuerpo) {
        return ejecutar(jwt, id, clave, cuerpo, false, false);
    }
    @PostMapping("/orders/{id}/confirmar")
    public ResponseEntity<String> confirmarOrden(@AuthenticationPrincipal Jwt jwt, @PathVariable String id,
            @RequestHeader(name = "Idempotency-Key", required = false) String clave, @RequestBody(required = false) String cuerpo) {
        return ejecutar(jwt, id, clave, cuerpo, true, true);
    }
    @PostMapping("/orders/{id}/cancelar")
    public ResponseEntity<String> cancelarOrden(@AuthenticationPrincipal Jwt jwt, @PathVariable String id,
            @RequestHeader(name = "Idempotency-Key", required = false) String clave, @RequestBody(required = false) String cuerpo) {
        return ejecutar(jwt, id, clave, cuerpo, true, false);
    }
    private ResponseEntity<String> ejecutar(Jwt jwt, String id, String clave, String cuerpo, boolean orden, boolean confirmar) {
        if (!"CLIENTE".equals(jwt.getClaimAsString("role"))) throw error(HttpStatus.FORBIDDEN, "ROL_NO_PERMITIDO",
                "Solo un cliente puede confirmar o cancelar sus compras.");
        UUID usuario;
        try { usuario = CreacionCompraService.uuid(jwt.getSubject()); }
        catch (BusinessException invalid) { throw error(HttpStatus.FORBIDDEN, "USUARIO_INVALIDO", "El token no identifica a un usuario válido."); }
        UUID key;
        try { key = CreacionCompraService.uuid(clave); }
        catch (BusinessException invalid) { throw error(HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_INVALIDA", "Idempotency-Key debe ser un UUID."); }
        if (cuerpo != null && !cuerpo.isBlank()) throw error(HttpStatus.BAD_REQUEST, "SOLICITUD_INVALIDA", "La acción no admite cuerpo.");
        var respuesta = revisiones.ejecutar(usuario, CreacionCompraService.uuid(id), orden, confirmar, key);
        var builder = ResponseEntity.status(respuesta.status()).cacheControl(CacheControl.noStore())
                .contentType(respuesta.status() == 200 ? MediaType.APPLICATION_JSON : MediaType.APPLICATION_PROBLEM_JSON);
        if (respuesta.replay()) builder.header("Idempotency-Replayed", "true");
        if (respuesta.reintentar()) builder.header("Retry-After", "2");
        return builder.body(respuesta.cuerpo());
    }
    private static BusinessException error(HttpStatus status, String code, String detail) {
        return new BusinessException(status, URI.create("/problems/" + code.toLowerCase(java.util.Locale.ROOT).replace('_', '-')),
                "Solicitud inválida", detail, code);
    }
}
