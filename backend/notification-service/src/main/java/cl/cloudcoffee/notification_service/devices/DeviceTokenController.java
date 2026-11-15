package cl.cloudcoffee.notification_service.devices;

import cl.cloudcoffee.errors.BusinessException;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.UUID;

@RestController
@RequestMapping("/notifications/device-token")
public class DeviceTokenController {

    private final DeviceTokenService service;

    public DeviceTokenController(DeviceTokenService service) {
        this.service = service;
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Void> registrar(@AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody DeviceTokenRequest request) {
        service.registrar(userId(jwt), required(request));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @DeleteMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Void> eliminar(@AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody DeviceTokenRequest request) {
        service.eliminar(userId(jwt), required(request));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    private static DeviceTokenRequest required(DeviceTokenRequest request) {
        if (request == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/token-dispositivo-invalido"),
                    "Token de dispositivo inválido", "El cuerpo de la solicitud es obligatorio.",
                    "TOKEN_DISPOSITIVO_INVALIDO");
        }
        return request;
    }

    private static UUID userId(Jwt jwt) {
        try {
            return UUID.fromString(jwt.getSubject());
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(HttpStatus.FORBIDDEN, URI.create("/problems/usuario-invalido"),
                    "Usuario inválido", "El token no identifica a un usuario válido.", "USUARIO_INVALIDO");
        }
    }
}
