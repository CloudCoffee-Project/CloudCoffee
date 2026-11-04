package cl.cloudcoffee.order_service.controller;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.order_service.dto.CompraResponse;
import cl.cloudcoffee.order_service.dto.OrdenResponse;
import cl.cloudcoffee.order_service.dto.PaginaComprasResponse;
import cl.cloudcoffee.order_service.service.ConsultaComprasService;
import java.net.URI;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Lecturas del comprador (INT2-72); Gateway elimina el prefijo público /v1. */
@RestController
public class ConsultaComprasController {
    private final ConsultaComprasService consultas;

    public ConsultaComprasController(ConsultaComprasService consultas) {
        this.consultas = consultas;
    }

    @GetMapping("/compras")
    public ResponseEntity<PaginaComprasResponse> historial(@AuthenticationPrincipal Jwt jwt,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(consultas.historial(cliente(jwt), page, size));
    }

    @GetMapping("/compras/{compraId}")
    public ResponseEntity<CompraResponse> compra(@PathVariable UUID compraId, @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(consultas.compra(cliente(jwt), compraId));
    }

    @GetMapping("/orders/{ordenId}")
    public ResponseEntity<OrdenResponse> orden(@PathVariable UUID ordenId, @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(consultas.orden(cliente(jwt), ordenId));
    }

    private static UUID cliente(Jwt jwt) {
        if (!"CLIENTE".equals(jwt.getClaimAsString("role"))) {
            throw new BusinessException(HttpStatus.FORBIDDEN, URI.create("/problems/rol-no-permitido"),
                    "Rol no permitido", "Solo un cliente puede consultar sus compras y órdenes.", "ROL_NO_PERMITIDO");
        }
        try {
            return UUID.fromString(jwt.getSubject());
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(HttpStatus.FORBIDDEN, URI.create("/problems/usuario-invalido"),
                    "Usuario inválido", "El token no identifica a un usuario válido.", "USUARIO_INVALIDO");
        }
    }
}
