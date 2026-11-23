package cl.cloudcoffee.order_service.comprobantes;

import cl.cloudcoffee.errors.BusinessException;
import java.net.URI;
import java.util.UUID;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

/** Gateway conserva el cuerpo binario bajo /v1/orders/{ordenId}/boleta. */
@RestController
public class ComprobanteController {
    private final ComprobanteService comprobantes;
    public ComprobanteController(ComprobanteService comprobantes) { this.comprobantes = comprobantes; }

    @GetMapping("/orders/{ordenId}/boleta")
    public ResponseEntity<byte[]> descargar(@PathVariable UUID ordenId, @AuthenticationPrincipal Jwt jwt) {
        if (!"CLIENTE".equals(jwt.getClaimAsString("role"))) throw new BusinessException(HttpStatus.FORBIDDEN,
                URI.create("/problems/rol-no-permitido"), "Rol no permitido",
                "Solo un cliente puede descargar sus comprobantes.", "ROL_NO_PERMITIDO");
        UUID propietario;
        try { propietario = UUID.fromString(jwt.getSubject()); }
        catch (IllegalArgumentException error) { throw new BusinessException(HttpStatus.FORBIDDEN,
                URI.create("/problems/usuario-invalido"), "Usuario inválido", "El token no identifica un usuario válido.", "USUARIO_INVALIDO"); }
        byte[] contenido = comprobantes.descargar(propietario, ordenId);
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_PDF).cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(ComprobanteService.nombre(ordenId)).build().toString())
                .contentLength(contenido.length).body(contenido);
    }
}
