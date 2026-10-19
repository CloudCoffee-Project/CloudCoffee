package cl.cloudcoffee.auth_service.service;

import java.util.EnumSet;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.auth_service.model.AsignacionCafeteria;
import cl.cloudcoffee.auth_service.model.Rol;
import cl.cloudcoffee.auth_service.repository.AsignacionCafeteriaRepository;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.security.AsignacionesCafeteria;

/**
 * Fuente de verdad de la asignación del personal (INT2-65). Solo un CAJERO o
 * ADMIN_CAFETERIA activo y no eliminado tiene cafetería; para cualquier otro
 * usuario la respuesta es vacía aunque exista una fila de asignación.
 */
@Service
public class AsignacionPersonalService implements AsignacionesCafeteria {

    private static final Set<Rol> ROLES_PERSONAL = EnumSet.of(Rol.CAJERO, Rol.ADMIN_CAFETERIA);

    private final UsuarioRepository usuarioRepository;
    private final AsignacionCafeteriaRepository asignacionRepository;

    public AsignacionPersonalService(UsuarioRepository usuarioRepository,
            AsignacionCafeteriaRepository asignacionRepository) {
        this.usuarioRepository = usuarioRepository;
        this.asignacionRepository = asignacionRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<UUID> cafeteriaDe(UUID usuarioId) {
        return usuarioRepository.findById(usuarioId)
                .filter(usuario -> usuario.isActivo() && !usuario.isEliminado()
                        && ROLES_PERSONAL.contains(usuario.getRol()))
                .flatMap(usuario -> asignacionRepository.findById(usuario.getId()))
                .map(AsignacionCafeteria::getCafeteriaId);
    }
}
