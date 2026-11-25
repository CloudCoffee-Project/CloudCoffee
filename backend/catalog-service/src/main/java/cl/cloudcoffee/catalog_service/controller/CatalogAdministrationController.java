package cl.cloudcoffee.catalog_service.controller;

import java.net.URI;
import java.util.UUID;

import org.springdoc.core.annotations.ParameterObject;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import cl.cloudcoffee.catalog_service.dto.CategoryAdminResponse;
import cl.cloudcoffee.catalog_service.dto.AdminPageResponse;
import cl.cloudcoffee.catalog_service.dto.CrearCategoriaRequest;
import cl.cloudcoffee.catalog_service.dto.CrearProductoRequest;
import cl.cloudcoffee.catalog_service.dto.EditarCategoriaRequest;
import cl.cloudcoffee.catalog_service.dto.EditarProductoRequest;
import cl.cloudcoffee.catalog_service.dto.ProductAdminResponse;
import cl.cloudcoffee.catalog_service.service.CatalogAdministrationService;
import cl.cloudcoffee.errors.BusinessException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;

@Validated
@Tag(name = "Administración de catálogo", description = "Mantenimiento del catálogo maestro por SUPER_ADMIN")
@SecurityRequirement(name = "bearerAuth")
@RestController
@RequestMapping("/catalog/admin")
public class CatalogAdministrationController {
    private static final String IDEMPOTENCY_REPLAYED = "Idempotency-Replayed";
    private final CatalogAdministrationService service;

    public CatalogAdministrationController(CatalogAdministrationService service) {
        this.service = service;
    }

    @Operation(operationId = "listarCategoriasAdmin", summary = "Listar categorías, incluidas las inactivas")
    @ApiResponse(responseCode = "200", description = "Página de categorías")
    @GetMapping("/categorias")
    public AdminPageResponse<CategoryAdminResponse> listarCategorias(@RequestParam(required = false) Boolean activo,
            @ParameterObject Pageable pageable, Authentication auth) {
        return AdminPageResponse.from(service.listarCategorias(activo, pageable, auth));
    }

    @Operation(operationId = "crearCategoria", summary = "Crear una categoría")
    @ApiResponse(responseCode = "201", description = "Categoría creada", headers = {
            @Header(name = "Location", schema = @Schema(type = "string")),
            @Header(name = IDEMPOTENCY_REPLAYED, schema = @Schema(type = "boolean"))
    })
    @PostMapping(path = "/categorias", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<CategoryAdminResponse> crearCategoria(
            @RequestHeader("Idempotency-Key") String key, @Valid @RequestBody CrearCategoriaRequest request,
            Authentication auth) {
        var result = service.crearCategoria(request, parseKey(key), auth);
        var response = ResponseEntity.created(
                URI.create("/v1/catalog/admin/categorias/" + result.response().categoriaId()));
        if (result.replayed()) response.header(IDEMPOTENCY_REPLAYED, "true");
        return response.body(result.response());
    }

    @Operation(operationId = "editarCategoria", summary = "Editar una categoría con control de versión")
    @PatchMapping(path = "/categorias/{categoriaId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    public CategoryAdminResponse editarCategoria(@PathVariable UUID categoriaId,
            @Valid @RequestBody EditarCategoriaRequest request, Authentication auth) {
        return service.editarCategoria(categoriaId, request, auth);
    }

    @Operation(operationId = "bajaCategoria", summary = "Dar de baja una categoría sin productos activos")
    @PostMapping("/categorias/{categoriaId}/baja")
    public CategoryAdminResponse bajaCategoria(@PathVariable UUID categoriaId, Authentication auth) {
        return service.bajaCategoria(categoriaId, auth);
    }

    @Operation(operationId = "reactivarCategoria", summary = "Reactivar una categoría")
    @PostMapping("/categorias/{categoriaId}/reactivar")
    public CategoryAdminResponse reactivarCategoria(@PathVariable UUID categoriaId, Authentication auth) {
        return service.reactivarCategoria(categoriaId, auth);
    }

    @Operation(operationId = "listarProductosAdmin", summary = "Listar productos con filtros y paginación")
    @GetMapping("/productos")
    public AdminPageResponse<ProductAdminResponse> listarProductos(
            @RequestParam(required = false) UUID categoriaId,
            @RequestParam(required = false) @Size(min = 2, max = 100) String q,
            @RequestParam(required = false) Boolean activo, @ParameterObject Pageable pageable, Authentication auth) {
        return AdminPageResponse.from(service.listarProductos(categoriaId, q, activo, pageable, auth));
    }

    @Operation(operationId = "crearProducto", summary = "Crear un producto en una categoría activa")
    @ApiResponse(responseCode = "201", description = "Producto creado", headers = {
            @Header(name = "Location", schema = @Schema(type = "string")),
            @Header(name = IDEMPOTENCY_REPLAYED, schema = @Schema(type = "boolean"))
    })
    @PostMapping(path = "/productos", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ProductAdminResponse> crearProducto(
            @RequestHeader("Idempotency-Key") String key, @Valid @RequestBody CrearProductoRequest request,
            Authentication auth) {
        var result = service.crearProducto(request, parseKey(key), auth);
        var response = ResponseEntity.created(
                URI.create("/v1/catalog/admin/productos/" + result.response().productoId()));
        if (result.replayed()) response.header(IDEMPOTENCY_REPLAYED, "true");
        return response.body(result.response());
    }

    @Operation(operationId = "editarProducto", summary = "Editar los datos de un producto con control de versión")
    @PatchMapping(path = "/productos/{productoId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ProductAdminResponse editarProducto(@PathVariable UUID productoId,
            @Valid @RequestBody EditarProductoRequest request, Authentication auth) {
        return service.editarProducto(productoId, request, auth);
    }

    @Operation(operationId = "bajaProducto", summary = "Dar de baja lógicamente un producto")
    @PostMapping("/productos/{productoId}/baja")
    public ProductAdminResponse bajaProducto(@PathVariable UUID productoId, Authentication auth) {
        return service.bajaProducto(productoId, auth);
    }

    @Operation(operationId = "reactivarProducto", summary = "Reactivar un producto")
    @PostMapping("/productos/{productoId}/reactivar")
    public ProductAdminResponse reactivarProducto(@PathVariable UUID productoId, Authentication auth) {
        return service.reactivarProducto(productoId, auth);
    }

    private static UUID parseKey(String key) {
        try {
            UUID uuid = UUID.fromString(key);
            if (uuid.toString().equalsIgnoreCase(key)) return uuid;
        } catch (IllegalArgumentException ignored) {
            // Return one stable validation error for all malformed UUIDs.
        }
        throw new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/idempotency-key-invalida"),
                "Idempotency-Key inválida", "Idempotency-Key debe ser un UUID.", "IDEMPOTENCY_KEY_INVALIDA");
    }
}
