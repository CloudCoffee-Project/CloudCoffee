package cl.cloudcoffee.order_service.controller;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.order_service.creacion.CreacionCompraService;
import java.net.URI;
import java.util.UUID;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;

@RestController
public class CreacionCompraController {
    private final CreacionCompraService creacion;
    public CreacionCompraController(CreacionCompraService creacion) { this.creacion = creacion; }

    @PostMapping(path = "/compras", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> crear(@AuthenticationPrincipal Jwt jwt,
            @RequestHeader(name = "Idempotency-Key", required = false) String clave, @RequestBody JsonNode cuerpo) {
        if (!"CLIENTE".equals(jwt.getClaimAsString("role"))) {
            throw new BusinessException(HttpStatus.FORBIDDEN, URI.create("/problems/rol-no-permitido"),
                    "Rol no permitido", "Solo un cliente puede crear compras.", "ROL_NO_PERMITIDO");
        }
        UUID usuario;
        try { usuario = CreacionCompraService.uuid(jwt.getSubject()); }
        catch (BusinessException invalid) {
            throw new BusinessException(HttpStatus.FORBIDDEN, URI.create("/problems/usuario-invalido"),
                    "Usuario inválido", "El token no identifica a un usuario válido.", "USUARIO_INVALIDO");
        }
        UUID key;
        try { key = CreacionCompraService.uuid(clave); }
        catch (BusinessException invalid) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/idempotency-key-invalida"),
                    "Idempotency-Key inválida", "Idempotency-Key debe ser un UUID.", "IDEMPOTENCY_KEY_INVALIDA");
        }
        var respuesta = creacion.crear(usuario, key, cuerpo);
        var builder = ResponseEntity.status(respuesta.status()).cacheControl(CacheControl.noStore())
                .contentType(respuesta.status() == 201 ? MediaType.APPLICATION_JSON : MediaType.APPLICATION_PROBLEM_JSON);
        if (respuesta.location() != null) builder.header("Location", respuesta.location());
        if (respuesta.replay()) builder.header("Idempotency-Replayed", "true");
        if (respuesta.status() == 503 || respuesta.status() == 409 && respuesta.cuerpo().contains("IDEMPOTENCY_IN_PROGRESS"))
            builder.header("Retry-After", "2");
        return builder.body(respuesta.cuerpo());
    }
}
