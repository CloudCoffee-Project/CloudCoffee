package cl.cloudcoffee.catalog_service.controller;

import java.util.List;
import java.util.UUID;

import org.springdoc.core.annotations.ParameterObject;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.Parameters;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import cl.cloudcoffee.catalog_service.dto.CampusResponse;
import cl.cloudcoffee.catalog_service.dto.CategoryResponse;
import cl.cloudcoffee.catalog_service.dto.ProductOfferResponse;
import cl.cloudcoffee.catalog_service.dto.ProductResponse;
import cl.cloudcoffee.catalog_service.service.PublicCatalogQueryService;

@Tag(name = "Catálogo", description = "Campus, categorías, productos y comparación de ofertas")
@RestController
@RequestMapping("/catalog")
public class PublicCatalogController {

    private final PublicCatalogQueryService queryService;

    public PublicCatalogController(PublicCatalogQueryService queryService) {
        this.queryService = queryService;
    }

    @Operation(operationId = "listarCampus", summary = "Listar campus y sus cafeterías",
            description = "Consulta pública. Campus y cafeterías ordenados por nombre; devuelve una lista vacía si no hay datos.")
    @ApiResponse(responseCode = "200", description = "Lista de campus")
    @GetMapping("/campus")
    public List<CampusResponse> findAllCampus() {
        return queryService.findAllCampus();
    }

    @Operation(operationId = "listarCategorias", summary = "Listar categorías",
            description = "Consulta pública. Categorías ordenadas por nombre; devuelve una lista vacía si no hay datos.")
    @ApiResponse(responseCode = "200", description = "Lista de categorías")
    @GetMapping("/categorias")
    public List<CategoryResponse> findAllCategories() {
        return queryService.findAllCategories();
    }

    @Operation(operationId = "buscarProductos", summary = "Explorar y buscar productos por campus",
            description = "Requiere JWT según la seguridad actual. Devuelve la página de productos disponibles en el campus. Conserva la serialización actual de Spring Data Page, incluidos content y metadatos. Un filtro sin coincidencias devuelve una página vacía.")
    @SecurityRequirement(name = "bearerAuth")
    @ApiResponse(responseCode = "200", description = "Página de productos")
    @Parameters({
            @Parameter(name = "page", description = "Índice de página desde cero; los negativos se resuelven a cero", schema = @Schema(type = "integer", defaultValue = "0")),
            @Parameter(name = "size", description = "Tamaño de página: 20 por defecto, máximo 2000; los valores menores que 1 usan el defecto", schema = @Schema(type = "integer", defaultValue = "20")),
            @Parameter(name = "sort", description = "Orden opcional: propiedad,asc o propiedad,desc. Se puede repetir. Ejemplo: name,asc")
    })
    @GetMapping("/productos")
    public Page<ProductResponse> findProducts(
            @Parameter(description = "UUID del campus", example = "11111111-1111-4111-8111-111111111111")
            @RequestParam UUID campusId,
            @Parameter(description = "UUID de categoría para filtrar", example = "22222222-2222-4222-8222-222222222222")
            @RequestParam(required = false) UUID categoriaId,
            @Parameter(description = "Texto opcional de búsqueda sin distinguir mayúsculas en nombre o descripción", example = "café")
            @RequestParam(required = false) String q,
            @ParameterObject Pageable pageable) {
        return queryService.findProducts(campusId, categoriaId, q, pageable);
    }

    @Operation(operationId = "compararOfertas", summary = "Comparar ofertas de un producto por cafetería",
            description = "Requiere JWT según la seguridad actual. Filtra ofertas AVAILABLE de cafeterías OPEN por producto y campus, ordenadas por precio ascendente; disponible indica stock mayor que cero. Si no hay ofertas coincidentes devuelve una lista vacía, incluso para identificadores inexistentes.")
    @SecurityRequirement(name = "bearerAuth")
    @ApiResponse(responseCode = "200", description = "Lista de ofertas")
    @GetMapping("/productos/{id}/ofertas")
    public List<ProductOfferResponse> findProductOffers(
            @Parameter(description = "UUID del producto", example = "33333333-3333-4333-8333-333333333333")
            @PathVariable UUID id,
            @Parameter(description = "UUID del campus", example = "11111111-1111-4111-8111-111111111111")
            @RequestParam UUID campusId) {
        return queryService.findProductOffers(id, campusId);
    }
}
