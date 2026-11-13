package cl.cloudcoffee.catalog_service.controller;

import java.net.URI;
import java.util.List;
import java.util.UUID;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import cl.cloudcoffee.catalog_service.dto.CrearSeguimientoRequest;
import cl.cloudcoffee.catalog_service.dto.SeguimientoResponse;
import cl.cloudcoffee.catalog_service.service.ProductFollowService;
import cl.cloudcoffee.errors.BusinessException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;

/** INT2-116: el cliente sigue productos para enterarse cuando vuelven a tener stock. */
@Tag(name = "Seguimientos", description = "Productos que sigue el cliente autenticado")
@SecurityRequirement(name = "bearerAuth")
@RestController
@RequestMapping("/catalog/seguimientos")
public class ProductFollowController {

    static final String TOTAL_HEADER = "X-Total-Count";

    private final ProductFollowService follows;

    public ProductFollowController(ProductFollowService follows) {
        this.follows = follows;
    }

    @Operation(operationId = "listarSeguimientos", summary = "Listar los seguimientos propios",
            description = "Solo CLIENTE; devuelve únicamente los seguimientos activos del usuario del JWT, del más "
                    + "reciente al más antiguo. Responde un arreglo, como lo consume la app; page y size son opcionales "
                    + "y el total va en X-Total-Count.")
    @ApiResponse(responseCode = "200", description = "Seguimientos activos",
            headers = @Header(name = TOTAL_HEADER, description = "Total de seguimientos activos del usuario",
                    schema = @Schema(type = "integer")))
    @GetMapping
    public ResponseEntity<List<SeguimientoResponse>> listar(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "Página desde cero", schema = @Schema(type = "integer", defaultValue = "0", minimum = "0"))
            @RequestParam(defaultValue = "0") int page,
            @Parameter(description = "Tamaño de página, entre 1 y 100", schema = @Schema(type = "integer", defaultValue = "100", minimum = "1", maximum = "100"))
            @RequestParam(defaultValue = "100") int size) {
        UUID cliente = cliente(jwt);
        if (page < 0 || size < 1 || size > 100) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/paginacion-invalida"),
                    "Paginación inválida", "page debe ser mayor o igual a 0 y size debe estar entre 1 y 100.",
                    "PAGINACION_INVALIDA");
        }
        var pagina = follows.listar(cliente, page, size);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .header(TOTAL_HEADER, String.valueOf(pagina.getTotalElements()))
                .body(pagina.getContent());
    }

    @Operation(operationId = "seguirProducto", summary = "Seguir un producto",
            description = "Solo CLIENTE. Sin cafeteriaId sigue el producto en cualquier cafetería; con cafeteriaId, "
                    + "esa cafetería debe ofrecerlo, aunque esté agotado. Es único por usuario, producto y cafetería: "
                    + "repetir el alta, incluso en paralelo, devuelve el mismo seguimiento con 200.")
    @ApiResponse(responseCode = "201", description = "Seguimiento creado o reactivado",
            headers = @Header(name = "Location", schema = @Schema(type = "string")))
    @ApiResponse(responseCode = "200", description = "El seguimiento ya existía; no se duplica")
    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<SeguimientoResponse> seguir(@AuthenticationPrincipal Jwt jwt,
            @RequestBody CrearSeguimientoRequest request) {
        UUID cliente = cliente(jwt);
        var resultado = follows.seguir(cliente, request.productoId(), request.cafeteriaId());
        if (!resultado.creado()) {
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(resultado.seguimiento());
        }
        return ResponseEntity.created(URI.create("/v1/catalog/seguimientos/" + resultado.seguimiento().id()))
                .cacheControl(CacheControl.noStore()).body(resultado.seguimiento());
    }

    @Operation(operationId = "dejarDeSeguir", summary = "Dejar de seguir un producto",
            description = "Solo CLIENTE dueño del seguimiento. Repetir la baja vuelve a responder 204; un seguimiento "
                    + "ajeno o inexistente responde 404.")
    @ApiResponse(responseCode = "204", description = "Seguimiento dado de baja")
    @DeleteMapping("/{seguimientoId}")
    public ResponseEntity<Void> dejarDeSeguir(@AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "UUID del seguimiento") @PathVariable UUID seguimientoId) {
        follows.dejarDeSeguir(cliente(jwt), seguimientoId);
        return ResponseEntity.noContent().build();
    }

    // Solo CLIENTE; el dueño se toma del sub del JWT firmado, nunca de parámetros del cliente.
    private static UUID cliente(Jwt jwt) {
        if (!"CLIENTE".equals(jwt.getClaimAsString("role"))) {
            throw new BusinessException(HttpStatus.FORBIDDEN, URI.create("/problems/rol-no-permitido"),
                    "Rol no permitido", "Solo un cliente puede gestionar seguimientos de productos.", "ROL_NO_PERMITIDO");
        }
        try {
            return UUID.fromString(jwt.getSubject());
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(HttpStatus.FORBIDDEN, URI.create("/problems/usuario-invalido"),
                    "Usuario inválido", "El token no identifica a un usuario válido.", "USUARIO_INVALIDO");
        }
    }
}
