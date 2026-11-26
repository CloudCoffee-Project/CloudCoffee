package cl.cloudcoffee.catalog_service.controller;

import java.net.URI;
import java.util.UUID;

import org.springdoc.core.annotations.ParameterObject;
import org.springframework.data.domain.Pageable;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import cl.cloudcoffee.catalog_service.dto.AdjustStockRequest;
import cl.cloudcoffee.catalog_service.dto.AdminPageResponse;
import cl.cloudcoffee.catalog_service.dto.CafeteriaInventoryItemResponse;
import cl.cloudcoffee.catalog_service.dto.CrearOfertaRequest;
import cl.cloudcoffee.catalog_service.dto.EditarOfertaRequest;
import cl.cloudcoffee.catalog_service.dto.OfertaAdminResponse;
import cl.cloudcoffee.catalog_service.dto.StockAdjustmentResponse;
import cl.cloudcoffee.catalog_service.service.CafeteriaInventoryService;
import cl.cloudcoffee.catalog_service.service.OfferAdministrationService;
import cl.cloudcoffee.catalog_service.service.StockAdjustmentService;
import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.security.CafeteriaAccess;

@Tag(name = "Personal de cafetería", description = "Operaciones restringidas a la cafetería asignada")
@RestController
@RequestMapping("/catalog/cafeterias")
public class StaffCatalogController {

    private static final String STOCK_ADJUSTMENTS = "/{cafeteriaId}/ofertas/{ofertaId}/ajustes-stock";
    private static final String IDEMPOTENCY_KEY = "Idempotency-Key";
    private static final String IDEMPOTENCY_REPLAYED = "Idempotency-Replayed";

    private final CafeteriaInventoryService inventoryService;
    private final CafeteriaAccess cafeteriaAccess;
    private final StockAdjustmentService stockAdjustments;
    private final OfferAdministrationService offerAdministration;

    public StaffCatalogController(CafeteriaInventoryService inventoryService, CafeteriaAccess cafeteriaAccess,
            StockAdjustmentService stockAdjustments, OfferAdministrationService offerAdministration) {
        this.inventoryService = inventoryService;
        this.cafeteriaAccess = cafeteriaAccess;
        this.stockAdjustments = stockAdjustments;
        this.offerAdministration = offerAdministration;
    }

    @Operation(operationId = "inventarioCafeteria", summary = "Inventario de la cafetería asignada",
            description = "Requiere JWT de CAJERO o ADMIN_CAFETERIA cuya asignación persistida en Auth coincida "
                    + "con la ruta; el claim cafeteriaId no autoriza. Devuelve todas las ofertas, sin filtrar por estado, "
                    + "ordenadas por nombre de producto. Personal sin asignación, de otra cafetería, clientes y "
                    + "SUPER_ADMIN reciben 403.")
    @SecurityRequirement(name = "bearerAuth")
    @ApiResponse(responseCode = "200", description = "Ofertas de la cafetería")
    @GetMapping("/{cafeteriaId}/ofertas")
    public AdminPageResponse<CafeteriaInventoryItemResponse> findInventory(
            @Parameter(description = "UUID de la cafetería", example = "44444444-4444-4444-8444-444444444444")
            @PathVariable UUID cafeteriaId,
            @RequestParam(required = false) Boolean activa,
            @ParameterObject Pageable pageable,
            Authentication authentication) {
        cafeteriaAccess.verificar(authentication, cafeteriaId);
        return AdminPageResponse.from(inventoryService.findInventory(cafeteriaId, activa, pageable));
    }

    @Operation(operationId = "crearOferta", summary = "Crear una oferta de cafetería")
    @SecurityRequirement(name = "bearerAuth")
    @PostMapping(path = "/{cafeteriaId}/ofertas", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<OfertaAdminResponse> crearOferta(@PathVariable UUID cafeteriaId,
            @RequestHeader(IDEMPOTENCY_KEY) String key,
            @jakarta.validation.Valid @RequestBody CrearOfertaRequest request,
            Authentication authentication) {
        var result = offerAdministration.crear(cafeteriaId, request, idempotencyKey(key), authentication);
        URI location = URI.create("/catalog/cafeterias/" + cafeteriaId + "/ofertas/" + result.response().ofertaId());
        ResponseEntity.BodyBuilder response = ResponseEntity.created(location);
        if (result.replayed()) response.header(IDEMPOTENCY_REPLAYED, "true");
        return response.body(result.response());
    }

    @Operation(operationId = "editarPrecioOferta", summary = "Cambiar el precio de una oferta")
    @SecurityRequirement(name = "bearerAuth")
    @PatchMapping(path = "/{cafeteriaId}/ofertas/{ofertaId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    public OfertaAdminResponse editarOferta(@PathVariable UUID cafeteriaId, @PathVariable UUID ofertaId,
            @jakarta.validation.Valid @RequestBody EditarOfertaRequest request,
            Authentication authentication) {
        return offerAdministration.editar(cafeteriaId, ofertaId, request, authentication);
    }

    @Operation(operationId = "bajaOferta", summary = "Retirar administrativamente una oferta")
    @SecurityRequirement(name = "bearerAuth")
    @PostMapping("/{cafeteriaId}/ofertas/{ofertaId}/baja")
    public OfertaAdminResponse bajaOferta(@PathVariable UUID cafeteriaId, @PathVariable UUID ofertaId,
            Authentication authentication) {
        return offerAdministration.baja(cafeteriaId, ofertaId, authentication);
    }

    @Operation(operationId = "reactivarOferta", summary = "Reactivar una oferta retirada")
    @SecurityRequirement(name = "bearerAuth")
    @PostMapping("/{cafeteriaId}/ofertas/{ofertaId}/reactivar")
    public OfertaAdminResponse reactivarOferta(@PathVariable UUID cafeteriaId, @PathVariable UUID ofertaId,
            Authentication authentication) {
        return offerAdministration.reactivar(cafeteriaId, ofertaId, authentication);
    }

    @Operation(operationId = "ajustarStock", summary = "Ajustar stock con registro auditado",
            description = "CAJERO o ADMIN_CAFETERIA con asignación persistida en Auth. La cantidad se suma al stock "
                    + "disponible, con las reservas ya descontadas. Repetir la clave y los datos reproduce el ajuste.")
    @SecurityRequirement(name = "bearerAuth")
    @ApiResponse(responseCode = "201", description = "Ajuste registrado",
            headers = {
                    @Header(name = "Location", schema = @Schema(type = "string")),
                    @Header(name = IDEMPOTENCY_REPLAYED, description = "Presente al reproducir un ajuste",
                            schema = @Schema(type = "boolean"))
            })
    @PostMapping(path = STOCK_ADJUSTMENTS, consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<StockAdjustmentResponse> adjustStock(
            @PathVariable UUID cafeteriaId, @PathVariable UUID ofertaId,
            @Parameter(description = "UUID de la intención de ajuste", schema = @Schema(type = "string", format = "uuid"))
            @RequestHeader(IDEMPOTENCY_KEY) String key, @RequestBody AdjustStockRequest request,
            Authentication authentication) {
        cafeteriaAccess.verificar(authentication, cafeteriaId);
        var jwt = (JwtAuthenticationToken) authentication;
        UUID actor = UUID.fromString(jwt.getToken().getSubject());
        var result = stockAdjustments.adjust(cafeteriaId, ofertaId, actor, idempotencyKey(key), request);
        var location = URI.create("/v1/catalog/cafeterias/" + cafeteriaId + "/ofertas/" + ofertaId
                + "/ajustes-stock/" + result.adjustment().ajusteId());
        var response = ResponseEntity.created(location).cacheControl(CacheControl.noStore());
        if (result.replayed()) {
            response.header(IDEMPOTENCY_REPLAYED, "true");
        }
        return response.body(result.adjustment());
    }

    private static UUID idempotencyKey(String key) {
        try {
            UUID uuid = UUID.fromString(key);
            if (uuid.toString().equalsIgnoreCase(key)) {
                return uuid;
            }
        } catch (IllegalArgumentException ignored) {
            // Se devuelve el mismo error para cualquier UUID no válido.
        }
        throw new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/idempotency-key-invalida"),
                "Idempotency-Key inválida", "Idempotency-Key debe ser un UUID.", "IDEMPOTENCY_KEY_INVALIDA");
    }
}
