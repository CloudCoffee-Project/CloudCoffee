package cl.cloudcoffee.auth_service.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.util.ReflectionUtils;

import cl.cloudcoffee.auth_service.dto.ChangePasswordRequest;
import cl.cloudcoffee.auth_service.dto.PerfilResponse;
import cl.cloudcoffee.auth_service.dto.UpdatePerfilRequest;
import cl.cloudcoffee.auth_service.model.Rol;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.errors.BusinessException;

@ExtendWith(MockitoExtension.class)
class PerfilServiceTest {

    @Mock
    private UsuarioRepository usuarioRepository;

    @Mock
    private PasswordEncoder passwordEncoder;

    @InjectMocks
    private PerfilService perfilService;

    /** Simula la asignación de id que hace JPA al persistir, ausente cuando se usa un repositorio mockeado. */
    private static Usuario usuarioDePrueba() {
        Usuario usuario = new Usuario("cliente@cloudcoffee.cl", "hash-almacenado", Rol.CLIENTE, "Ana", "Pérez",
                "+56912345678");
        var idField = ReflectionUtils.findField(Usuario.class, "id");
        ReflectionUtils.makeAccessible(idField);
        ReflectionUtils.setField(idField, usuario, UUID.randomUUID());
        return usuario;
    }

    private static void assertNotFound(Throwable exception) {
        BusinessException businessException = (BusinessException) exception;
        assertThat(businessException.getStatus().value()).isEqualTo(404);
    }

    @Test
    void obtenerPerfilMapeaLosDatosDelUsuario() {
        Usuario usuario = usuarioDePrueba();
        when(usuarioRepository.findById(usuario.getId())).thenReturn(Optional.of(usuario));

        PerfilResponse perfil = perfilService.obtenerPerfilUsuario(usuario.getId().toString());

        assertThat(perfil).isEqualTo(new PerfilResponse(usuario.getId(), "cliente@cloudcoffee.cl", "Ana", "Pérez",
                "+56912345678", Rol.CLIENTE));
    }

    @Test
    void usuarioInexistenteRetornaNotFoundEnTodasLasOperaciones() {
        UUID id = UUID.randomUUID();
        when(usuarioRepository.findById(id)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> perfilService.obtenerPerfilUsuario(id.toString()))
                .isInstanceOf(BusinessException.class).satisfies(PerfilServiceTest::assertNotFound);
        assertThatThrownBy(() -> perfilService.actualizarPerfilUsuario(id.toString(),
                new UpdatePerfilRequest("Nuevo", null, null)))
                .isInstanceOf(BusinessException.class).satisfies(PerfilServiceTest::assertNotFound);
        assertThatThrownBy(() -> perfilService.cambiarPassword(id.toString(),
                new ChangePasswordRequest("password123", "nuevaPassword")))
                .isInstanceOf(BusinessException.class).satisfies(PerfilServiceTest::assertNotFound);

        verify(usuarioRepository, never()).save(any());
        verify(passwordEncoder, never()).encode(anyString());
    }

    @Test
    void actualizarIgnoraCamposNulosOVacios() {
        Usuario usuario = usuarioDePrueba();
        when(usuarioRepository.findById(usuario.getId())).thenReturn(Optional.of(usuario));
        when(usuarioRepository.save(usuario)).thenReturn(usuario);

        PerfilResponse perfil = perfilService.actualizarPerfilUsuario(usuario.getId().toString(),
                new UpdatePerfilRequest(null, "  ", "+56987654321"));

        assertThat(perfil.nombre()).isEqualTo("Ana");
        assertThat(perfil.apellido()).isEqualTo("Pérez");
        assertThat(perfil.telefono()).isEqualTo("+56987654321");
    }

    @Test
    void cambiarPasswordGuardaElNuevoHash() {
        Usuario usuario = usuarioDePrueba();
        when(usuarioRepository.findById(usuario.getId())).thenReturn(Optional.of(usuario));
        when(passwordEncoder.matches("password123", "hash-almacenado")).thenReturn(true);
        when(passwordEncoder.encode("nuevaPassword")).thenReturn("hash-nuevo");

        perfilService.cambiarPassword(usuario.getId().toString(),
                new ChangePasswordRequest("password123", "nuevaPassword"));

        assertThat(usuario.getPasswordHash()).isEqualTo("hash-nuevo");
        verify(usuarioRepository).save(usuario);
    }

    @Test
    void cambiarPasswordRechazaPasswordActualIncorrectaSinGuardar() {
        Usuario usuario = usuarioDePrueba();
        when(usuarioRepository.findById(usuario.getId())).thenReturn(Optional.of(usuario));
        when(passwordEncoder.matches("incorrecta", "hash-almacenado")).thenReturn(false);

        assertThatThrownBy(() -> perfilService.cambiarPassword(usuario.getId().toString(),
                new ChangePasswordRequest("incorrecta", "nuevaPassword")))
                .isInstanceOf(BusinessException.class)
                .satisfies(exception -> assertThat(((BusinessException) exception).getStatus().value()).isEqualTo(401));

        assertThat(usuario.getPasswordHash()).isEqualTo("hash-almacenado");
        verify(passwordEncoder, never()).encode(anyString());
        verify(usuarioRepository, never()).save(any());
    }
}
