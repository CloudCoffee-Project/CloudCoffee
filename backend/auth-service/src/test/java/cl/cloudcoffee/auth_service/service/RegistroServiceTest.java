package cl.cloudcoffee.auth_service.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.lang.reflect.Field;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.util.ReflectionUtils;

import cl.cloudcoffee.auth_service.dto.RegistroClienteRequest;
import cl.cloudcoffee.auth_service.dto.RegistroClienteResponse;
import cl.cloudcoffee.auth_service.messaging.AuthEventPublisher;
import cl.cloudcoffee.auth_service.model.Rol;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.errors.BusinessException;

@ExtendWith(MockitoExtension.class)
class RegistroServiceTest {

    @Mock
    private UsuarioRepository usuarioRepository;

    @Mock
    private PasswordEncoder passwordEncoder;

    @Mock
    private AuthEventPublisher eventPublisher;

    @Mock
    private VerificacionService verificacionService;

    @InjectMocks
    private RegistroService registroService;

    private RegistroClienteRequest requestValido() {
        return new RegistroClienteRequest("cliente@cloudcoffee.cl", "password123", "Ana", "Pérez", "+56912345678");
    }

    /** Simula la asignación de id que hace JPA al persistir, ausente cuando se usa un repositorio mockeado. */
    private static Usuario conIdAsignado(Usuario usuario) {
        Field idField = ReflectionUtils.findField(Usuario.class, "id");
        ReflectionUtils.makeAccessible(idField);
        ReflectionUtils.setField(idField, usuario, UUID.randomUUID());
        return usuario;
    }

    @Test
    void registraClienteConRolClienteYCuentaNoVerificada() {
        RegistroClienteRequest request = requestValido();
        when(usuarioRepository.existsByEmail(request.email())).thenReturn(false);
        when(passwordEncoder.encode(request.password())).thenReturn("hash-seguro");
        when(usuarioRepository.save(any(Usuario.class)))
                .thenAnswer(invocation -> conIdAsignado(invocation.getArgument(0)));

        RegistroClienteResponse response = registroService.registrarCliente(request, "trace-1");

        assertThat(response.email()).isEqualTo(request.email());
        assertThat(response.nombre()).isEqualTo(request.nombre());
        assertThat(response.apellido()).isEqualTo(request.apellido());
        assertThat(response.telefono()).isEqualTo(request.telefono());
        assertThat(response.rol()).isEqualTo(Rol.CLIENTE);
        assertThat(response.verificado()).isFalse();

        verify(eventPublisher).publishUserRegistered(anyString(), eq(request.email()), eq("trace-1"));
        verify(verificacionService).solicitarVerificacion(any(Usuario.class), eq("trace-1"));
    }

    @Test
    void guardaElPasswordHasheadoNuncaEnTextoPlano() {
        RegistroClienteRequest request = requestValido();
        when(usuarioRepository.existsByEmail(request.email())).thenReturn(false);
        when(passwordEncoder.encode(request.password())).thenReturn("hash-seguro");
        when(usuarioRepository.save(any(Usuario.class)))
                .thenAnswer(invocation -> conIdAsignado(invocation.getArgument(0)));

        registroService.registrarCliente(request, "trace-1");

        ArgumentCaptor<Usuario> captor = ArgumentCaptor.forClass(Usuario.class);
        verify(usuarioRepository).save(captor.capture());
        assertThat(captor.getValue().getPasswordHash()).isEqualTo("hash-seguro");
    }

    @Test
    void rechazaRegistroConEmailDuplicado() {
        RegistroClienteRequest request = requestValido();
        when(usuarioRepository.existsByEmail(request.email())).thenReturn(true);

        assertThatThrownBy(() -> registroService.registrarCliente(request, "trace-1"))
                .isInstanceOf(BusinessException.class)
                .satisfies(exception -> {
                    BusinessException businessException = (BusinessException) exception;
                    assertThat(businessException.getStatus().value()).isEqualTo(409);
                });

        verifyNoInteractions(passwordEncoder, eventPublisher, verificacionService);
    }
}
