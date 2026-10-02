package cl.cloudcoffee.auth_service.controller;

import cl.cloudcoffee.auth_service.dto.PerfilResponse;
import cl.cloudcoffee.auth_service.dto.UpdatePerfilRequest;
import cl.cloudcoffee.auth_service.service.PerfilService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import cl.cloudcoffee.auth_service.dto.ChangePasswordRequest;

import java.security.Principal;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;

@Tag(name = "Perfil", description = "Perfil propio del usuario identificado por el subject del JWT")
@SecurityRequirement(name = "bearerAuth")
@RestController
@RequestMapping("/auth/users")
public class UserController {

    private final PerfilService perfilService;

    public UserController(PerfilService perfilService) {
        this.perfilService = perfilService;
    }

    @Operation(operationId = "consultarPerfil", summary = "Consultar perfil propio")
    @ApiResponse(responseCode = "200", description = "Perfil del usuario autenticado",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = PerfilResponse.class)))
    @GetMapping("/me")
    public ResponseEntity<PerfilResponse> getMiPerfil(@Parameter(hidden = true) Principal principal) {
        String email = principal.getName();

        PerfilResponse perfil = perfilService.obtenerPerfilUsuario(email);
        return ResponseEntity.ok(perfil);
    }

    @Operation(operationId = "editarPerfil", summary = "Editar perfil propio",
            description = "Actualiza nombre, apellido y teléfono. Los campos omitidos, nulos o en blanco conservan el valor anterior; las validaciones del teléfono siguen aplicándose si se proporciona.")
    @ApiResponse(responseCode = "200", description = "Perfil actualizado",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = PerfilResponse.class)))
    @PatchMapping("/me")
    public ResponseEntity<PerfilResponse> updateMiPerfil(
            @Parameter(hidden = true) Principal principal,
            @Valid @RequestBody UpdatePerfilRequest request) {

        String email = principal.getName();

        PerfilResponse perfilActualizado = perfilService.actualizarPerfilUsuario(email, request);
        return ResponseEntity.ok(perfilActualizado);
    }
    @Operation(operationId = "cambiarPassword", summary = "Cambiar contraseña propia",
            description = "Comprueba la contraseña actual y guarda la nueva. La longitud mínima actual es 6 caracteres. No revoca tokens. En la implementación actual, una contraseña actual incorrecta produce 500.")
    @ApiResponse(responseCode = "200", description = "Contraseña actualizada, sin cuerpo", content = @Content)
    @PatchMapping("/me/password")
    public ResponseEntity<Void> cambiarPassword(
        @Parameter(hidden = true) Principal principal,
        @Valid @RequestBody ChangePasswordRequest request) {
            String email = principal.getName();
            perfilService.cambiarPassword(email, request);
            return ResponseEntity.ok().build();
        }
}
