package cl.cloudcoffee.auth_service.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import com.nimbusds.jose.JWSAlgorithm;

import cl.cloudcoffee.auth_service.model.AsignacionCafeteria;
import cl.cloudcoffee.auth_service.model.Rol;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.AsignacionCafeteriaRepository;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.security.testing.JwtTestSupport;

/** INT2-65 / INT2-50: consulta interna autenticada de la asignación del personal. */
@SpringBootTest(properties = "spring.rabbitmq.listener.simple.auto-startup=false")
@AutoConfigureMockMvc
class InternalAsignacionControllerTest extends JwtTestSupport {

    static final String RUTA = "/internal/servicios/asignaciones/{usuarioId}";

    @DynamicPropertySource
    static void privateKey(DynamicPropertyRegistry registry) {
        registry.add("JWT_PRIVATE_KEY_LOCATION", () -> PRIVATE_KEY_LOCATION);
    }

    @MockitoBean RabbitTemplate rabbitTemplate;
    @Autowired MockMvc mvc;
    @Autowired UsuarioRepository usuarios;
    @Autowired AsignacionCafeteriaRepository asignaciones;

    @ParameterizedTest
    @EnumSource(value = Rol.class, names = {"CAJERO", "ADMIN_CAFETERIA"})
    void devuelveLaCafeteriaPersistidaDelPersonal(Rol rol) throws Exception {
        Usuario usuario = usuario(rol);
        UUID cafeteria = asignar(usuario);

        consultar(usuario.getId(), INTERNAL_TOKEN)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.usuarioId").value(usuario.getId().toString()))
                .andExpect(jsonPath("$.cafeteriaId").value(cafeteria.toString()));
    }

    @Test
    void personalSinAsignacionResponde404() throws Exception {
        consultar(usuario(Rol.CAJERO).getId(), INTERNAL_TOKEN)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("/problems/asignacion-no-encontrada"));
    }

    @ParameterizedTest
    @EnumSource(value = Rol.class, names = {"CLIENTE", "SUPER_ADMIN"})
    void rolesQueNoSonPersonalNoTienenCafeteriaAunqueExistaLaFila(Rol rol) throws Exception {
        Usuario usuario = usuario(rol);
        asignar(usuario);

        consultar(usuario.getId(), INTERNAL_TOKEN).andExpect(status().isNotFound());
    }

    @Test
    void personalDesactivadoPierdeSuCafeteria() throws Exception {
        Usuario usuario = usuario(Rol.CAJERO);
        asignar(usuario);
        usuario.desactivar();
        usuarios.saveAndFlush(usuario);

        consultar(usuario.getId(), INTERNAL_TOKEN).andExpect(status().isNotFound());
    }

    @Test
    void usuarioInexistenteResponde404() throws Exception {
        consultar(UUID.randomUUID(), INTERNAL_TOKEN).andExpect(status().isNotFound());
    }

    @Test
    void sinTokenInternoOConJwtDeUsuarioNoSeConsulta() throws Exception {
        Usuario usuario = usuario(Rol.CAJERO);
        asignar(usuario);

        mvc.perform(get(RUTA, usuario.getId())).andExpect(status().isUnauthorized());
        consultar(usuario.getId(), "token-incorrecto-de-largo-suficiente-0000").andExpect(status().isUnauthorized());
        String jwtDelPropioCajero = sign(claims().subject(usuario.getId().toString()).claim("role", "CAJERO").build(),
                KEYS, JWSAlgorithm.RS256);
        mvc.perform(get(RUTA, usuario.getId()).header("Authorization", "Bearer " + jwtDelPropioCajero))
                .andExpect(status().isForbidden());
    }

    private ResultActions consultar(UUID usuarioId, String token) throws Exception {
        return mvc.perform(get(RUTA, usuarioId).header("X-Internal-Service-Token", token));
    }

    private Usuario usuario(Rol rol) {
        Usuario usuario = new Usuario(UUID.randomUUID() + "@cloudcoffee.dev", "hash", rol, "Ana", "Pérez", "+56912345678");
        usuario.verificar();
        return usuarios.saveAndFlush(usuario);
    }

    private UUID asignar(Usuario usuario) {
        UUID cafeteria = UUID.randomUUID();
        asignaciones.saveAndFlush(new AsignacionCafeteria(usuario.getId(), cafeteria));
        return cafeteria;
    }
}
