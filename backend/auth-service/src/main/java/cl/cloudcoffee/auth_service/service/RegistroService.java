package cl.cloudcoffee.auth_service.service;

import java.net.URI;

import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.auth_service.dto.RegistroClienteRequest;
import cl.cloudcoffee.auth_service.dto.RegistroClienteResponse;
import cl.cloudcoffee.auth_service.messaging.AuthEventPublisher;
import cl.cloudcoffee.auth_service.model.Rol;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.errors.BusinessException;

@Service
public class RegistroService {

    private final UsuarioRepository usuarioRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuthEventPublisher eventPublisher;
    private final VerificacionService verificacionService;

    public RegistroService(UsuarioRepository usuarioRepository, PasswordEncoder passwordEncoder,
            AuthEventPublisher eventPublisher, VerificacionService verificacionService) {
        this.usuarioRepository = usuarioRepository;
        this.passwordEncoder = passwordEncoder;
        this.eventPublisher = eventPublisher;
        this.verificacionService = verificacionService;
    }

    @Transactional
    public RegistroClienteResponse registrarCliente(RegistroClienteRequest request, String traceId) {
        if (usuarioRepository.existsByEmail(request.email())) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/email-ya-registrado"),
                    "Correo ya registrado", "Ya existe una cuenta asociada a este correo electrónico.");
        }

        String passwordHash = passwordEncoder.encode(request.password());
        Usuario usuario = new Usuario(request.email(), passwordHash, Rol.CLIENTE,
                request.nombre(), request.apellido(), request.telefono());
        usuario = usuarioRepository.save(usuario);

        eventPublisher.publishUserRegistered(usuario.getId().toString(), usuario.getEmail(), traceId);
        verificacionService.solicitarVerificacion(usuario, traceId);

        return RegistroClienteResponse.from(usuario);
    }
}
