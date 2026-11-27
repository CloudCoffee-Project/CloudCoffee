package cl.cloudcoffee.auth_service.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockito.ArgumentCaptor;
import org.springframework.amqp.AmqpException;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import cl.cloudcoffee.auth_service.messaging.AuthEventPublisher;
import cl.cloudcoffee.auth_service.messaging.CloudCoffeeEvent;
import cl.cloudcoffee.auth_service.model.Rol;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.TokenAuthRepository;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.auth_service.service.CatalogoCafeterias;
import cl.cloudcoffee.auth_service.service.ComprasEnCurso;
import cl.cloudcoffee.auth_service.service.JwtTokenService;
import cl.cloudcoffee.auth_service.service.LoginService;
import cl.cloudcoffee.auth_service.service.OperacionPendienteException;
import cl.cloudcoffee.security.testing.JwtTestSupport;

/** INT2-129: baja de la cuenta propia conservando compras y auditoría. */
@SpringBootTest(properties = {"spring.rabbitmq.listener.simple.auto-startup=false",
        "management.health.rabbit.enabled=false", "management.tracing.enabled=false"})
@AutoConfigureMockMvc
class BajaPropiaIntegrationTest extends JwtTestSupport {

    static final String PASSWORD = "ClaveSegura2026";

    @DynamicPropertySource
    static void privateKey(DynamicPropertyRegistry registry) {
        registry.add("JWT_PRIVATE_KEY_LOCATION", () -> PRIVATE_KEY_LOCATION);
    }

    @Autowired MockMvc mvc;
    @Autowired UsuarioRepository usuarios;
    @Autowired TokenAuthRepository tokens;
    @Autowired JwtTokenService jwtTokenService;
    @Autowired LoginService loginService;
    @Autowired PasswordEncoder passwordEncoder;
    @MockitoBean RabbitTemplate rabbitTemplate;
    @MockitoBean ComprasEnCurso comprasEnCurso;
    @MockitoBean CatalogoCafeterias catalogo;

    Usuario cliente;

    @BeforeEach
    void setUp() {
        reset(rabbitTemplate, comprasEnCurso);
        cliente = cuenta(Rol.CLIENTE);
    }

    @Test
    void anonymizesTheAccountRevokesSessionsAndKeepsTheId() throws Exception {
        String jwt = jwt(cliente);
        String refresh = loginService.iniciarSesion(cliente.getEmail(), PASSWORD).refreshToken();

        baja(jwt, PASSWORD).andExpect(status().isNoContent());

        Usuario anonima = usuarios.findById(cliente.getId()).orElseThrow();
        assertThat(anonima.isEliminado()).isTrue();
        assertThat(anonima.isActivo()).isFalse();
        assertThat(anonima.getEmail()).isEqualTo("eliminado+" + cliente.getId() + "@anonimo.invalid");
        assertThat(anonima.getNombre()).isEqualTo("Usuario");
        assertThat(anonima.getApellido()).isEqualTo("eliminado");
        assertThat(anonima.getTelefono()).isEqualTo("000000");
        assertThat(passwordEncoder.matches(PASSWORD, anonima.getPasswordHash())).isFalse();
        assertThat(tokens.findByUsuarioIdAndRevokedAtIsNull(cliente.getId())).isEmpty();
        // Solo se consultan las compras de la cuenta del JWT.
        verify(comprasEnCurso).contar(cliente.getId());

        // INT2-105: ni refresh ni login para una cuenta eliminada.
        refrescar(refresh).andExpect(status().isUnauthorized());
        login(cliente.getEmail()).andExpect(status().isUnauthorized());

        CloudCoffeeEvent evento = eventoPublicado();
        assertThat(evento.payload()).containsEntry("usuarioId", cliente.getId().toString())
                .containsEntry("rolAnterior", "CLIENTE").containsEntry("origen", "baja_propia")
                .doesNotContainKey("email");
        assertThat(evento.traceId()).matches("[0-9a-f]{32}");

        // El correo queda libre para una cuenta nueva, sin vínculo con la anterior.
        mvc.perform(post("/auth/register").contentType(MediaType.APPLICATION_JSON).content(
                "{\"email\":\"" + cliente.getEmail() + "\",\"password\":\"" + PASSWORD + "\",\"nombre\":\"Ana\","
                        + "\"apellido\":\"Nueva\",\"telefono\":\"+56912345678\"}"))
                .andExpect(status().isCreated());
    }

    @Test
    void aWrongPasswordChangesNothingAndDoesNotAskOrder() throws Exception {
        baja(jwt(cliente), "OtraClave123").andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("CONTRASENA_INCORRECTA"));
        verify(comprasEnCurso, never()).contar(any());
        assertThat(usuarios.findById(cliente.getId()).orElseThrow().isEliminado()).isFalse();
        verifyNoAnonymization();
    }

    @Test
    void purchasesInProgressBlockTheRemovalUntilTheyClose() throws Exception {
        String jwt = jwt(cliente);
        String refresh = loginService.iniciarSesion(cliente.getEmail(), PASSWORD).refreshToken();
        when(comprasEnCurso.contar(cliente.getId())).thenReturn(1L);

        baja(jwt, PASSWORD).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("COMPRAS_EN_CURSO"));
        assertThat(usuarios.findById(cliente.getId()).orElseThrow().isEliminado()).isFalse();
        verifyNoAnonymization();

        // Política recuperable: nada cambió, la sesión sigue y basta con reintentar cuando terminen.
        refresh = loginService.iniciarSesion(cliente.getEmail(), PASSWORD).refreshToken();
        refrescar(refresh).andExpect(status().isOk());
        when(comprasEnCurso.contar(cliente.getId())).thenReturn(0L);
        baja(jwt, PASSWORD).andExpect(status().isNoContent());
        assertThat(usuarios.findById(cliente.getId()).orElseThrow().isEliminado()).isTrue();
    }

    @Test
    void whenOrderDoesNotAnswerNothingChanges() throws Exception {
        when(comprasEnCurso.contar(cliente.getId())).thenThrow(new OperacionPendienteException("Order no responde."));
        baja(jwt(cliente), PASSWORD).andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("OPERACION_PENDIENTE"));
        assertThat(usuarios.findById(cliente.getId()).orElseThrow().isEliminado()).isFalse();
        login(cliente.getEmail()).andExpect(status().isOk());
        verifyNoAnonymization();
    }

    @Test
    void repeatingTheRemovalIsIdempotentAndRecoversALostEvent() throws Exception {
        String jwt = jwt(cliente);
        // Fallo parcial: la baja se confirma aunque el broker no esté disponible.
        doThrow(new AmqpException("broker caído")).when(rabbitTemplate)
                .convertAndSend(anyString(), eq(AuthEventPublisher.USUARIO_ANONIMIZADO_EVENT), any(Object.class));
        baja(jwt, PASSWORD).andExpect(status().isNoContent());
        assertThat(usuarios.findById(cliente.getId()).orElseThrow().isEliminado()).isTrue();

        // El reintento responde igual (sin exigir la contraseña, que ya no existe) y vuelve a publicar.
        reset(rabbitTemplate);
        baja(jwt, "cualquier-cosa").andExpect(status().isNoContent());
        assertThat(eventoPublicado().payload()).containsEntry("usuarioId", cliente.getId().toString());
        verify(comprasEnCurso, times(1)).contar(cliente.getId());
    }

    @Test
    void concurrentRemovalsAnonymizeOnce() throws Exception {
        String jwt = jwt(cliente);
        CountDownLatch salida = new CountDownLatch(1);
        List<Integer> estados = new ArrayList<>();
        try (var pool = Executors.newFixedThreadPool(2)) {
            List<Future<Integer>> futuros = new ArrayList<>();
            for (int i = 0; i < 2; i++) {
                futuros.add(pool.submit(() -> {
                    salida.await();
                    return baja(jwt, PASSWORD).andReturn().getResponse().getStatus();
                }));
            }
            salida.countDown();
            for (Future<Integer> futuro : futuros) estados.add(futuro.get());
        }
        assertThat(estados).containsOnly(204);
        assertThat(usuarios.findById(cliente.getId()).orElseThrow().isEliminado()).isTrue();
    }

    @ParameterizedTest
    @EnumSource(value = Rol.class, names = {"CAJERO", "ADMIN_CAFETERIA", "SUPER_ADMIN"})
    void staffAccountsAreManagedByTheirAdministrator(Rol rol) throws Exception {
        Usuario personal = cuenta(rol);
        baja(jwt(personal), PASSWORD).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ROL_NO_PERMITIDO"));
        assertThat(usuarios.findById(personal.getId()).orElseThrow().isEliminado()).isFalse();
    }

    @Test
    void neverAcceptsAnotherUsersIdAndRequiresAJwt() throws Exception {
        Usuario otro = cuenta(Rol.CLIENTE);
        mvc.perform(post("/auth/users/me/baja").header("Authorization", jwt(cliente))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"passwordActual\":\"" + PASSWORD + "\",\"usuarioId\":\"" + otro.getId() + "\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/auth/users/me/baja").contentType(MediaType.APPLICATION_JSON)
                .content("{\"passwordActual\":\"" + PASSWORD + "\"}")).andExpect(status().isUnauthorized());
        mvc.perform(post("/auth/users/me/baja").header("Authorization", jwt(cliente))
                .contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isBadRequest());
        assertThat(usuarios.findById(otro.getId()).orElseThrow().isEliminado()).isFalse();
        assertThat(usuarios.findById(cliente.getId()).orElseThrow().isEliminado()).isFalse();
        verify(comprasEnCurso, never()).contar(any());
    }

    @Test
    void aDeactivatedAccountCannotRemoveItself() throws Exception {
        String jwt = jwt(cliente);
        cliente.desactivar();
        usuarios.saveAndFlush(cliente);
        baja(jwt, PASSWORD).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("ESTADO_INVALIDO"));
        verifyNoAnonymization();
    }

    private Usuario cuenta(Rol rol) {
        Usuario usuario = new Usuario("baja-" + UUID.randomUUID() + "@uct.cl", passwordEncoder.encode(PASSWORD), rol,
                "Ana", "Pérez", "+56912345678");
        usuario.verificar();
        return usuarios.saveAndFlush(usuario);
    }

    private String jwt(Usuario usuario) {
        return "Bearer " + jwtTokenService.emitir(usuario);
    }

    private ResultActions baja(String jwt, String password) throws Exception {
        return mvc.perform(post("/auth/users/me/baja").header("Authorization", jwt)
                .contentType(MediaType.APPLICATION_JSON).content("{\"passwordActual\":\"" + password + "\"}"));
    }

    private ResultActions login(String email) throws Exception {
        return mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"password\":\"" + PASSWORD + "\"}"));
    }

    private ResultActions refrescar(String refresh) throws Exception {
        return mvc.perform(post("/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                .content("{\"refreshToken\":\"" + refresh + "\"}"));
    }

    private CloudCoffeeEvent eventoPublicado() {
        ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
        verify(rabbitTemplate, atLeastOnce()).convertAndSend(anyString(),
                eq(AuthEventPublisher.USUARIO_ANONIMIZADO_EVENT), captor.capture());
        return (CloudCoffeeEvent) captor.getValue();
    }

    private void verifyNoAnonymization() {
        verify(rabbitTemplate, never()).convertAndSend(anyString(),
                eq(AuthEventPublisher.USUARIO_ANONIMIZADO_EVENT), any(Object.class));
    }
}
