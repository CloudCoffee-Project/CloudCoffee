package cl.cloudcoffee.auth_service.controller;

import java.net.URI;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import cl.cloudcoffee.auth_service.service.AsignacionPersonalService;
import cl.cloudcoffee.errors.BusinessException;

/**
 * INT2-65 / INT2-50: mecanismo interno autenticado para que otros servicios
 * comprueben la asignación del personal sin leer tablas de auth-service.
 *
 * Solo acepta el token entre servicios (ver InternalServiceAuthenticationFilter);
 * Gateway no lo expone porque solo enruta rutas bajo /v1.
 */
@RestController
@RequestMapping("/internal/servicios/asignaciones")
public class InternalAsignacionController {

    private final AsignacionPersonalService asignaciones;

    public InternalAsignacionController(AsignacionPersonalService asignaciones) {
        this.asignaciones = asignaciones;
    }

    public record AsignacionResponse(UUID usuarioId, UUID cafeteriaId) {
    }

    /** 200 con la cafetería del personal activo; 404 si no tiene asignación vigente. */
    @GetMapping("/{usuarioId}")
    public AsignacionResponse asignacion(@PathVariable UUID usuarioId) {
        return asignaciones.cafeteriaDe(usuarioId)
                .map(cafeteriaId -> new AsignacionResponse(usuarioId, cafeteriaId))
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND,
                        URI.create("/problems/asignacion-no-encontrada"), "Asignación no encontrada",
                        "El usuario no tiene una cafetería asignada."));
    }
}
