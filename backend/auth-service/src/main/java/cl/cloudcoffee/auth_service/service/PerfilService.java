package cl.cloudcoffee.auth_service.service;

import cl.cloudcoffee.auth_service.dto.PerfilResponse;
import cl.cloudcoffee.auth_service.dto.UpdatePerfilRequest;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.errors.BusinessException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.security.crypto.password.PasswordEncoder;
import cl.cloudcoffee.auth_service.dto.ChangePasswordRequest;

import java.net.URI;

@Service
public class PerfilService {

    private final UsuarioRepository usuarioRepository;
    private final PasswordEncoder passwordEncoder;

    public PerfilService(UsuarioRepository usuarioRepository, PasswordEncoder passwordEncoder) {
        this.usuarioRepository = usuarioRepository;
        this.passwordEncoder = passwordEncoder;
    }

    public PerfilResponse obtenerPerfilUsuario(String idUsuario) {
        Usuario usuario = usuarioRepository.findById(java.util.UUID.fromString(idUsuario))
                .orElseThrow(() -> new RuntimeException("Usuario no encontrado"));

        return mapToResponse(usuario);
    }

    public PerfilResponse actualizarPerfilUsuario(String idUsuario, UpdatePerfilRequest request) {
        Usuario usuario = usuarioRepository.findById(java.util.UUID.fromString(idUsuario))
                .orElseThrow(() -> new RuntimeException("Usuario no encontrado"));

        if (request.nombre() != null && !request.nombre().isBlank()) {
            usuario.setNombre(request.nombre());
        }

        if (request.apellido() != null && !request.apellido().isBlank()) {
            usuario.setApellido(request.apellido());
        }

        if (request.telefono() != null && !request.telefono().isBlank()) {
            usuario.setTelefono(request.telefono());
        }

        Usuario usuarioActualizado = usuarioRepository.save(usuario);

        return mapToResponse(usuarioActualizado);
    }

    private PerfilResponse mapToResponse(Usuario usuario) {
        return new PerfilResponse(
                usuario.getId(),
                usuario.getEmail(),
                usuario.getNombre(),
                usuario.getApellido(),
                usuario.getTelefono(),
                usuario.getRol()
        );
    }
    public void cambiarPassword(String idUsuario, ChangePasswordRequest request) {
        Usuario usuario = usuarioRepository.findById(java.util.UUID.fromString(idUsuario))
                .orElseThrow(() -> new RuntimeException("Usuario no encontrado"));

        if (!passwordEncoder.matches(request.passwordActual(), usuario.getPasswordHash())) {
            throw new BusinessException(HttpStatus.UNAUTHORIZED,
                    URI.create("/problems/contrasena-actual-incorrecta"),
                    "Contraseña actual incorrecta",
                    "La contraseña actual no coincide con la del usuario.");
        }

        String nuevoHash = passwordEncoder.encode(request.passwordNueva());
        usuario.actualizarPasswordHash(nuevoHash);

        usuarioRepository.save(usuario);
    }
}
