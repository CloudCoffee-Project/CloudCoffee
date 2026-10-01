package cl.cloudcoffee.auth_service.controller;

import cl.cloudcoffee.auth_service.dto.PerfilResponse;
import cl.cloudcoffee.auth_service.dto.UpdatePerfilRequest;
import cl.cloudcoffee.auth_service.service.PerfilService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import cl.cloudcoffee.auth_service.dto.ChangePasswordRequest;

import java.security.Principal;

@RestController
@RequestMapping("/auth/users")
public class UserController {

    private final PerfilService perfilService;

    public UserController(PerfilService perfilService) {
        this.perfilService = perfilService;
    }

    @GetMapping("/me")
    public ResponseEntity<PerfilResponse> getMiPerfil(Principal principal) {
        String email = principal.getName();

        PerfilResponse perfil = perfilService.obtenerPerfilUsuario(email);
        return ResponseEntity.ok(perfil);
    }

    @PatchMapping("/me")
    public ResponseEntity<PerfilResponse> updateMiPerfil(
            Principal principal,
            @Valid @RequestBody UpdatePerfilRequest request) {

        String email = principal.getName();

        PerfilResponse perfilActualizado = perfilService.actualizarPerfilUsuario(email, request);
        return ResponseEntity.ok(perfilActualizado);
    }
    @PatchMapping("/me/password")
    public ResponseEntity<Void> cambiarPassword(
        Principal principal,
        @Valid @RequestBody ChangePasswordRequest request) {
            String email = principal.getName();
            perfilService.cambiarPassword(email, request);
            return ResponseEntity.ok().build();
        }
}
