package cl.cloudcoffee.order_service.controller;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.order_service.dto.PaginaOrdenesResponse;
import cl.cloudcoffee.order_service.service.ConsultaOrdenesService;
import java.net.URI;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Lecturas del cajero (INT2-78); Gateway elimina el prefijo público /v1. */
@RestController
public class ConsultaOrdenesController {
    private final ConsultaOrdenesService consultas;

    public ConsultaOrdenesController(ConsultaOrdenesService consultas) {
        this.consultas = consultas;
    }

    @GetMapping("/orders")
    public ResponseEntity<PaginaOrdenesResponse> listar(@AuthenticationPrincipal Jwt jwt,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String estado, @RequestParam(required = false) String codigoOrden) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(consultas.listar(cajero(jwt), page, size, estado, codigoOrden));
    }

    private static UUID cajero(Jwt jwt) {
        if (!"CAJERO".equals(jwt.getClaimAsString("role"))) {
            throw new BusinessException(HttpStatus.FORBIDDEN, URI.create("/problems/rol-no-permitido"),
                    "Rol no permitido", "Solo un cajero puede listar pedidos de su cafetería.", "ROL_NO_PERMITIDO");
        }
        try {
            return UUID.fromString(jwt.getSubject());
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(HttpStatus.FORBIDDEN, URI.create("/problems/usuario-invalido"),
                    "Usuario inválido", "El token no identifica a un usuario válido.", "USUARIO_INVALIDO");
        }
    }
}
