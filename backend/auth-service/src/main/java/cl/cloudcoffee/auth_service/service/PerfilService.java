package cl.cloudcoffee.auth_service.service;

import cl.cloudcoffee.auth_service.dto.PerfilResponse;
import cl.cloudcoffee.auth_service.dto.UpdatePerfilRequest;
import cl.cloudcoffee.auth_service.model.TipoToken;
import cl.cloudcoffee.auth_service.model.TokenAuth;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.TokenAuthRepository;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.errors.BusinessException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.security.crypto.password.PasswordEncoder;
import cl.cloudcoffee.auth_service.dto.ChangePasswordRequest;

import java.net.URI;

@Service
public class PerfilService {

    private final UsuarioRepository usuarioRepository;
    private final TokenAuthRepository tokenAuthRepository;
    private final PasswordEncoder passwordEncoder;

    public PerfilService(UsuarioRepository usuarioRepository, TokenAuthRepository tokenAuthRepository,
            PasswordEncoder passwordEncoder) {
        this.usuarioRepository = usuarioRepository;
        this.tokenAuthRepository = tokenAuthRepository;
        this.passwordEncoder = passwordEncoder;
    }

    public PerfilResponse obtenerPerfilUsuario(String idUsuario) {
        Usuario usuario = buscarUsuario(idUsuario);

        return mapToResponse(usuario);
    }

    public PerfilResponse actualizarPerfilUsuario(String idUsuario, UpdatePerfilRequest request) {
        Usuario usuario = buscarUsuario(idUsuario);

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

    private Usuario buscarUsuario(String idUsuario) {
        return usuarioRepository.findById(java.util.UUID.fromString(idUsuario))
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND,
                        URI.create("/problems/usuario-no-encontrado"), "Usuario no encontrado",
                        "No existe una cuenta asociada al usuario autenticado."));
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
    @Transactional
    public void cambiarPassword(String idUsuario, ChangePasswordRequest request) {
        Usuario usuario = buscarUsuario(idUsuario);

        if (!passwordEncoder.matches(request.passwordActual(), usuario.getPasswordHash())) {
            throw new BusinessException(HttpStatus.UNAUTHORIZED,
                    URI.create("/problems/contrasena-actual-incorrecta"),
                    "Contraseña actual incorrecta",
                    "La contraseña actual no coincide con la del usuario.");
        }

        String nuevoHash = passwordEncoder.encode(request.passwordNueva());
        usuario.actualizarPasswordHash(nuevoHash);

        usuarioRepository.save(usuario);

        // Cierra todas las sesiones previas, igual que el restablecimiento por correo.
        // Los access tokens ya emitidos son stateless y siguen vigentes hasta su expiración.
        tokenAuthRepository.findByUsuarioIdAndTipoAndRevokedAtIsNull(usuario.getId(), TipoToken.REFRESH)
                .forEach(TokenAuth::revocar);
    }
}
