package cl.cloudcoffee.catalog_service.controller;

import java.net.URI;
import java.util.UUID;

import org.springdoc.core.annotations.ParameterObject;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import cl.cloudcoffee.catalog_service.dto.*;
import cl.cloudcoffee.catalog_service.service.CafeteriaAdministrationService;
import jakarta.validation.Valid;

@Validated
@RestController
@RequestMapping("/catalog")
public class CafeteriaAdministrationController {
    private final CafeteriaAdministrationService service;

    public CafeteriaAdministrationController(CafeteriaAdministrationService service) {
        this.service = service;
    }

    @GetMapping("/admin/campus")
    public Page<CampusAdminResponse> listarCampus(@RequestParam(required = false) Boolean activo,
                                                   @ParameterObject Pageable pageable,
                                                   Authentication authentication) {
        superAdmin(authentication);
        return service.listarCampus(activo, pageable);
    }

    @PostMapping("/admin/campus")
    public ResponseEntity<CampusAdminResponse> crearCampus(@Valid @RequestBody CrearCampusRequest request,
                                                           Authentication authentication) {
        CampusAdminResponse response = service.crearCampus(request, authentication);
        return ResponseEntity.created(URI.create("/catalog/admin/campus/" + response.campusId())).body(response);
    }

    @PatchMapping("/admin/campus/{campusId}")
    public CampusAdminResponse editarCampus(@PathVariable UUID campusId,
                                            @Valid @RequestBody EditarCampusRequest request,
                                            Authentication authentication) {
        return service.editarCampus(campusId, request, authentication);
    }

    @PostMapping("/admin/campus/{campusId}/baja")
    public CampusAdminResponse bajaCampus(@PathVariable UUID campusId, Authentication authentication) {
        return service.bajaCampus(campusId, authentication);
    }

    @PostMapping("/admin/campus/{campusId}/reactivar")
    public CampusAdminResponse reactivarCampus(@PathVariable UUID campusId, Authentication authentication) {
        return service.reactivarCampus(campusId, authentication);
    }

    @GetMapping("/admin/cafeterias")
    public Page<CafeteriaResponse> listarCafeterias(@RequestParam(required = false) UUID campusId,
                                                     @RequestParam(required = false) Boolean activo,
                                                     @ParameterObject Pageable pageable,
                                                     Authentication authentication) {
        superAdmin(authentication);
        return service.listarCafeterias(campusId, activo, pageable);
    }

    @GetMapping("/admin/cafeterias/{cafeteriaId}")
    public CafeteriaResponse detalleCafeteria(@PathVariable UUID cafeteriaId, Authentication authentication) {
        superAdmin(authentication);
        return service.detalleCafeteria(cafeteriaId);
    }

    @PostMapping("/admin/cafeterias")
    public ResponseEntity<CafeteriaResponse> crearCafeteria(@Valid @RequestBody CrearCafeteriaRequest request,
                                                             Authentication authentication) {
        CafeteriaResponse response = service.crearCafeteria(request, authentication);
        return ResponseEntity.created(URI.create("/catalog/admin/cafeterias/" + response.cafeteriaId())).body(response);
    }

    @PatchMapping("/admin/cafeterias/{cafeteriaId}")
    public CafeteriaResponse editarCafeteria(@PathVariable UUID cafeteriaId,
                                             @Valid @RequestBody EditarCafeteriaRequest request,
                                             Authentication authentication) {
        return service.editarCafeteria(cafeteriaId, request, authentication);
    }

    @PostMapping("/admin/cafeterias/{cafeteriaId}/baja")
    public CafeteriaResponse bajaCafeteria(@PathVariable UUID cafeteriaId, Authentication authentication) {
        return service.bajaCafeteria(cafeteriaId, authentication);
    }

    @PostMapping("/admin/cafeterias/{cafeteriaId}/reactivar")
    public CafeteriaResponse reactivarCafeteria(@PathVariable UUID cafeteriaId, Authentication authentication) {
        return service.reactivarCafeteria(cafeteriaId, authentication);
    }
    
    @GetMapping("/cafeterias/{cafeteriaId}")
    public CafeteriaResponse detalleCafeteriaOperativa(@PathVariable UUID cafeteriaId,
                                                       Authentication authentication) {
        return service.detalleCafeteriaOperativa(cafeteriaId, authentication);
    }

    @PostMapping("/cafeterias/{cafeteriaId}/estado-operativo")
    public CafeteriaResponse cambiarEstadoOperativo(@PathVariable UUID cafeteriaId,
                                                    @Valid @RequestBody CambiarEstadoOperativoRequest request,
                                                    Authentication authentication) {
        return service.cambiarEstadoOperativo(cafeteriaId, request, authentication);
    }

    @GetMapping("/internal/servicios/cafeterias/{cafeteriaId}")
    public CafeteriaResponse detalleInternoCafeteria(@PathVariable UUID cafeteriaId) {
        return service.detalleCafeteria(cafeteriaId);
    }

    @GetMapping("/internal/servicios/catalogo/cafeterias/{cafeteriaId}")
    public CafeteriaResponse detalleInternoCatalogoCafeteria(@PathVariable UUID cafeteriaId) {
        return service.detalleCafeteria(cafeteriaId);
    }

    private static void superAdmin(Authentication authentication) {
        boolean allowed = authentication instanceof JwtAuthenticationToken token
                && "SUPER_ADMIN".equals(token.getToken().getClaimAsString("role"));
        if (!allowed) throw new AccessDeniedException("Rol no permitido");
    }
}
