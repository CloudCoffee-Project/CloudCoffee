package cl.cloudcoffee.order_service.controller;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.order_service.dto.PaginaVentasResponse;
import cl.cloudcoffee.order_service.dto.ResumenVentasResponse;
import cl.cloudcoffee.order_service.dto.VentaDetalleResponse;
import cl.cloudcoffee.order_service.service.ConsultaVentasService;
import java.net.URI;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/orders/ventas")
public class ConsultaVentasController {
    private final ConsultaVentasService ventas;

    public ConsultaVentasController(ConsultaVentasService ventas) {
        this.ventas = ventas;
    }

    @GetMapping
    public ResponseEntity<PaginaVentasResponse> listar(@AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) UUID cafeteriaId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate desde,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate hasta,
            @RequestParam(required = false) String estado,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(ventas.listar(admin(jwt), cafeteriaId, desde, hasta, estado, page, size));
    }

    @GetMapping("/resumen")
    public ResponseEntity<ResumenVentasResponse> resumen(@AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) UUID cafeteriaId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate desde,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate hasta,
            @RequestParam(required = false) String estado) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(ventas.resumen(admin(jwt), cafeteriaId, desde, hasta, estado));
    }

    @GetMapping("/{ordenId}")
    public ResponseEntity<VentaDetalleResponse> detalle(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID ordenId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(ventas.detalle(admin(jwt), ordenId));
    }

    private static UUID admin(Jwt jwt) {
        if (!"ADMIN_CAFETERIA".equals(jwt.getClaimAsString("role"))) {
            throw new BusinessException(HttpStatus.FORBIDDEN, URI.create("/problems/rol-no-permitido"),
                    "Rol no permitido", "Solo un administrador de cafetería puede consultar sus ventas.",
                    "ROL_NO_PERMITIDO");
        }
        try {
            return UUID.fromString(jwt.getSubject());
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(HttpStatus.FORBIDDEN, URI.create("/problems/usuario-invalido"),
                    "Usuario inválido", "El token no identifica a un usuario válido.", "USUARIO_INVALIDO");
        }
    }
}
