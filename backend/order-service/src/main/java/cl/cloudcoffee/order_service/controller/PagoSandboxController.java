package cl.cloudcoffee.order_service.controller;

import java.net.URI;
import java.util.UUID;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
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
import cl.cloudcoffee.order_service.dto.PagoSandboxResponse;
import cl.cloudcoffee.order_service.service.PagoSandboxService;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Pago con payment-service / Mercado Pago sandbox (contrato Payment 2.0.0, INT2-113). Gateway publica estas
 * rutas como {@code /v1/compras/{compraId}/pago}. El cliente solo elige el canal de retorno: nunca monto,
 * URL, estado ni escenario. Activo con {@code ORDER_PAYMENT_PROVIDER=mercadopago_sandbox}.
 */
@RestController
@RequestMapping("/compras/{compraId}/pago")
@ConditionalOnProperty(name = "cloudcoffee.pagos.provider", havingValue = "mercadopago_sandbox")
public class PagoSandboxController {

    private final PagoSandboxService pagos;
    private final JsonMapper json = JsonMapper.builder().build();

    public PagoSandboxController(PagoSandboxService pagos) {
        this.pagos = pagos;
    }

    /** 201 con el checkout; repetir la misma clave devuelve el estado actual con {@code Idempotency-Replayed}. */
    @PostMapping
    public ResponseEntity<PagoSandboxResponse> iniciar(@PathVariable UUID compraId,
            @RequestHeader(PagoSimuladoController.IDEMPOTENCY_KEY) String clave,
            @RequestBody(required = false) String cuerpo, @AuthenticationPrincipal Jwt jwt) {
        var respuesta = pagos.iniciar(cliente(jwt), compraId, claveUuid(clave), canal(cuerpo));
        ResponseEntity.BodyBuilder builder = ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .contentType(MediaType.APPLICATION_JSON)
                .header(HttpHeaders.LOCATION, "/v1/compras/" + compraId + "/pago")
                .header(PagoSimuladoController.IDEMPOTENCY_REPLAYED, String.valueOf(respuesta.replay()));
        return builder.body(respuesta.pago());
    }

    /** Proyección de Order; sin efectos. El retorno del navegador nunca aprueba un pago. */
    @GetMapping
    public ResponseEntity<PagoSandboxResponse> consultar(@PathVariable UUID compraId, @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(pagos.consultar(cliente(jwt), compraId));
    }

    /** {@code {"canalRetorno":"web"|"mobile"}} y nada más: un escenario, monto o URL es 400. */
    private String canal(String cuerpo) {
        JsonNode nodo;
        try {
            nodo = json.readTree(cuerpo == null ? "" : cuerpo);
        } catch (JacksonException error) {
            throw invalida("El cuerpo debe ser JSON.");
        }
        if (nodo == null || !nodo.isObject()) throw invalida("El cuerpo debe ser un objeto JSON.");
        for (var campo : nodo.properties()) {
            if (!"canalRetorno".equals(campo.getKey())) throw invalida("Campo no admitido: " + campo.getKey() + ".");
        }
        JsonNode canal = nodo.path("canalRetorno");
        if (!canal.isString() || !("web".equals(canal.asString()) || "mobile".equals(canal.asString()))) {
            throw invalida("canalRetorno debe ser web o mobile.");
        }
        return canal.asString();
    }

    private static BusinessException invalida(String detalle) {
        return new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/solicitud-invalida"),
                "Solicitud inválida", detalle, "SOLICITUD_INVALIDA");
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

    private static UUID claveUuid(String clave) {
        try {
            UUID uuid = UUID.fromString(clave);
            if (uuid.toString().equalsIgnoreCase(clave)) return uuid;
        } catch (IllegalArgumentException ignored) {
            // Se responde 400 abajo.
        }
        throw new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/idempotency-key-invalida"),
                "Idempotency-Key inválida", "Idempotency-Key debe ser un UUID.", "IDEMPOTENCY_KEY_INVALIDA");
    }
}
