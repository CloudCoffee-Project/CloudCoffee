package cl.cloudcoffee.catalog_service.controller;

import java.util.List;
import java.util.UUID;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import cl.cloudcoffee.catalog_service.dto.CafeteriaInventoryItemResponse;
import cl.cloudcoffee.catalog_service.service.CafeteriaInventoryService;
import cl.cloudcoffee.security.CafeteriaAccess;

@Tag(name = "Personal de cafetería", description = "Consultas restringidas a la cafetería asignada")
@RestController
@RequestMapping("/catalog/cafeterias")
public class StaffCatalogController {

    private final CafeteriaInventoryService inventoryService;
    private final CafeteriaAccess cafeteriaAccess;

    public StaffCatalogController(CafeteriaInventoryService inventoryService, CafeteriaAccess cafeteriaAccess) {
        this.inventoryService = inventoryService;
        this.cafeteriaAccess = cafeteriaAccess;
    }

    @Operation(operationId = "inventarioCafeteria", summary = "Inventario de la cafetería asignada",
            description = "Requiere JWT de CAJERO o ADMIN_CAFETERIA cuyo claim cafeteriaId coincida con la ruta; "
                    + "SUPER_ADMIN consulta cualquier cafetería. Devuelve todas las ofertas, sin filtrar por estado, "
                    + "ordenadas por nombre de producto. Personal sin asignación, de otra cafetería o clientes reciben 403.")
    @SecurityRequirement(name = "bearerAuth")
    @ApiResponse(responseCode = "200", description = "Ofertas de la cafetería")
    @GetMapping("/{cafeteriaId}/ofertas")
    public List<CafeteriaInventoryItemResponse> findInventory(
            @Parameter(description = "UUID de la cafetería", example = "44444444-4444-4444-8444-444444444444")
            @PathVariable UUID cafeteriaId,
            Authentication authentication) {
        cafeteriaAccess.verificar(authentication, cafeteriaId);
        return inventoryService.findInventory(cafeteriaId);
    }
}
