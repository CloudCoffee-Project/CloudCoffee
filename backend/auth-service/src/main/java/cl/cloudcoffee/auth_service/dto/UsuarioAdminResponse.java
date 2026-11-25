package cl.cloudcoffee.auth_service.dto;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonInclude;

import cl.cloudcoffee.auth_service.model.Usuario;
import io.swagger.v3.oas.annotations.media.Schema;

/** Recurso UsuarioAdmin del contrato INT2-109. Nunca incluye contraseña ni tokens. */
@Schema(name = "UsuarioAdmin")
public record UsuarioAdminResponse(
        UUID usuarioId,
        String email,
        String nombre,
        String apellido,
        String telefono,
        String rol,
        @JsonInclude(JsonInclude.Include.ALWAYS)
        @Schema(description = "Asignación persistida; null para CLIENTE y SUPER_ADMIN.", nullable = true)
        UUID cafeteriaId,
        @Schema(allowableValues = {"pendiente_activacion", "activa", "inactiva"})
        String estado,
        Instant creadoAt,
        Instant actualizadoAt,
        long version) {

    public static UsuarioAdminResponse from(Usuario usuario, UUID cafeteriaId) {
        return new UsuarioAdminResponse(usuario.getId(), usuario.getEmail(), usuario.getNombre(),
                usuario.getApellido(), usuario.getTelefono(), usuario.getRol().name(), cafeteriaId,
                estado(usuario), usuario.getCreatedAt(),
                usuario.getUpdatedAt() == null ? usuario.getCreatedAt() : usuario.getUpdatedAt(),
                usuario.getVersion());
    }

    static String estado(Usuario usuario) {
        if (!usuario.isActivo() || usuario.isEliminado()) return "inactiva";
        return usuario.isVerificado() ? "activa" : "pendiente_activacion";
    }
}
