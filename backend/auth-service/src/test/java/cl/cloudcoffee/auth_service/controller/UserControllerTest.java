package cl.cloudcoffee.auth_service.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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

import com.nimbusds.jose.JWSAlgorithm;

import cl.cloudcoffee.auth_service.model.Rol;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.auth_service.service.JwtTokenService;
import cl.cloudcoffee.security.testing.JwtTestSupport;

@SpringBootTest(properties = "spring.rabbitmq.listener.simple.auto-startup=false")
@AutoConfigureMockMvc
class UserControllerTest extends JwtTestSupport {

    @DynamicPropertySource
    static void privateKey(DynamicPropertyRegistry registry) {
        registry.add("JWT_PRIVATE_KEY_LOCATION", () -> PRIVATE_KEY_LOCATION);
    }

    @Autowired private MockMvc mvc;
    @Autowired private UsuarioRepository usuarios;
    @Autowired private JwtTokenService jwtTokenService;
    @Autowired private PasswordEncoder passwordEncoder;
    @MockitoBean private RabbitTemplate rabbitTemplate;

    private Usuario usuario() {
        Usuario usuario = new Usuario(UUID.randomUUID() + "@cloudcoffee.cl",
                passwordEncoder.encode("password123"), Rol.CLIENTE, "Ana", "Pérez", "+56912345678");
        usuario.verificar();
        return usuarios.saveAndFlush(usuario);
    }

    private String jwt(Usuario usuario) {
        return "Bearer " + jwtTokenService.emitir(usuario);
    }

    private Usuario recargar(Usuario usuario) {
        return usuarios.findById(usuario.getId()).orElseThrow();
    }

    private ResultActions actualizarPerfil(Usuario usuario, String cuerpo) throws Exception {
        return mvc.perform(patch("/auth/users/me").header("Authorization", jwt(usuario))
                .contentType(MediaType.APPLICATION_JSON).content(cuerpo));
    }

    private ResultActions cambiarPassword(Usuario usuario, String cuerpo) throws Exception {
        return mvc.perform(patch("/auth/users/me/password").header("Authorization", jwt(usuario))
                .contentType(MediaType.APPLICATION_JSON).content(cuerpo));
    }

    private static String cambioPasswordJson(String actual, String nueva) {
        return "{\"passwordActual\":\"%s\",\"passwordNueva\":\"%s\"}".formatted(actual, nueva);
    }

    private ResultActions login(String email, String password) throws Exception {
        return mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"%s\",\"password\":\"%s\"}".formatted(email, password)));
    }

    @Test
    void obtienePerfilDelUsuarioDelJwtSinExponerElHash() throws Exception {
        Usuario usuario = usuario();

        mvc.perform(get("/auth/users/me").header("Authorization", jwt(usuario)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(usuario.getId().toString()))
                .andExpect(jsonPath("$.email").value(usuario.getEmail()))
                .andExpect(jsonPath("$.nombre").value("Ana"))
                .andExpect(jsonPath("$.apellido").value("Pérez"))
                .andExpect(jsonPath("$.telefono").value("+56912345678"))
                .andExpect(jsonPath("$.rol").value("CLIENTE"))
                .andExpect(jsonPath("$.passwordHash").doesNotExist())
                .andExpect(jsonPath("$.password").doesNotExist());
    }

    @Test
    void endpointsDePerfilExigenJwt() throws Exception {
        mvc.perform(patch("/auth/users/me").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nombre\":\"Intruso\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
        mvc.perform(patch("/auth/users/me/password").contentType(MediaType.APPLICATION_JSON)
                        .content(cambioPasswordJson("password123", "otraPassword123")))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
    }

    @ParameterizedTest
    @ValueSource(strings = {"malformed", "expired", "wrong-key", "tampered"})
    void rechazaJwtInvalidoSinModificarElPerfil(String tipo) throws Exception {
        Usuario usuario = usuario();
        String jwtInvalido = "Bearer " + invalidToken(tipo);

        mvc.perform(get("/auth/users/me").header("Authorization", jwtInvalido))
                .andExpect(status().isUnauthorized());
        mvc.perform(patch("/auth/users/me").header("Authorization", jwtInvalido)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"nombre\":\"Intruso\"}"))
                .andExpect(status().isUnauthorized());

        assertThat(recargar(usuario).getNombre()).isEqualTo("Ana");
    }

    @Test
    void jwtValidoDeUsuarioInexistenteRetornaNotFound() throws Exception {
        String jwtHuerfano = "Bearer " + sign(claims().subject(UUID.randomUUID().toString()).build(),
                KEYS, JWSAlgorithm.RS256);

        mvc.perform(get("/auth/users/me").header("Authorization", jwtHuerfano))
                .andExpect(status().isNotFound())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.type").value("/problems/usuario-no-encontrado"));
        mvc.perform(patch("/auth/users/me").header("Authorization", jwtHuerfano)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"nombre\":\"Fantasma\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(patch("/auth/users/me/password").header("Authorization", jwtHuerfano)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cambioPasswordJson("password123", "otraPassword123")))
                .andExpect(status().isNotFound());
    }

    @Test
    void actualizaSoloLosCamposInformadosYNoVacios() throws Exception {
        Usuario usuario = usuario();

        actualizarPerfil(usuario, "{\"nombre\":\"Beatriz\",\"apellido\":\"   \"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nombre").value("Beatriz"))
                .andExpect(jsonPath("$.apellido").value("Pérez"))
                .andExpect(jsonPath("$.telefono").value("+56912345678"));

        Usuario actualizado = recargar(usuario);
        assertThat(actualizado.getNombre()).isEqualTo("Beatriz");
        assertThat(actualizado.getApellido()).isEqualTo("Pérez");
        assertThat(actualizado.getUpdatedAt()).isNotNull();
    }

    @Test
    void noPermiteCambiarEmailNiRolDesdeElPerfil() throws Exception {
        Usuario usuario = usuario();

        actualizarPerfil(usuario, """
                {"email":"otro@cloudcoffee.cl","rol":"SUPER_ADMIN","nombre":"Ana María"}
                """)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(usuario.getEmail()))
                .andExpect(jsonPath("$.rol").value("CLIENTE"));

        Usuario actualizado = recargar(usuario);
        assertThat(actualizado.getEmail()).isEqualTo(usuario.getEmail());
        assertThat(actualizado.getRol()).isEqualTo(Rol.CLIENTE);
    }

    @Test
    void unUsuarioSoloModificaSuPropioPerfil() throws Exception {
        Usuario usuarioA = usuario();
        Usuario usuarioB = usuario();

        actualizarPerfil(usuarioA, "{\"nombre\":\"Carla\"}").andExpect(status().isOk());

        assertThat(recargar(usuarioA).getNombre()).isEqualTo("Carla");
        assertThat(recargar(usuarioB).getNombre()).isEqualTo("Ana");
    }

    @ParameterizedTest
    @ValueSource(strings = {"{\"telefono\":\"abc\"}", "{\"telefono\":\"12345\"}",
            "{\"nombre\":\"%s\"}", "{\"apellido\":\"%s\"}"})
    void rechazaDatosDePerfilInvalidosSinPersistirlos(String plantilla) throws Exception {
        Usuario usuario = usuario();

        actualizarPerfil(usuario, plantilla.formatted("x".repeat(101)))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.errors").isArray());

        Usuario sinCambios = recargar(usuario);
        assertThat(sinCambios.getNombre()).isEqualTo("Ana");
        assertThat(sinCambios.getApellido()).isEqualTo("Pérez");
        assertThat(sinCambios.getTelefono()).isEqualTo("+56912345678");
    }

    @Test
    void cambiaPasswordYSoloLaNuevaPermiteIniciarSesion() throws Exception {
        Usuario usuario = usuario();

        cambiarPassword(usuario, cambioPasswordJson("password123", "nuevaPassword456"))
                .andExpect(status().isOk());

        assertThat(passwordEncoder.matches("nuevaPassword456", recargar(usuario).getPasswordHash())).isTrue();
        login(usuario.getEmail(), "password123").andExpect(status().isUnauthorized());
        login(usuario.getEmail(), "nuevaPassword456").andExpect(status().isOk());
    }

    @Test
    void rechazaCambioDePasswordConPasswordActualIncorrecta() throws Exception {
        Usuario usuario = usuario();
        String hashOriginal = usuario.getPasswordHash();

        cambiarPassword(usuario, cambioPasswordJson("password-incorrecta", "nuevaPassword456"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.type").value("/problems/contrasena-actual-incorrecta"));

        assertThat(recargar(usuario).getPasswordHash()).isEqualTo(hashOriginal);
        login(usuario.getEmail(), "password123").andExpect(status().isOk());
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"passwordActual\":\"\",\"passwordNueva\":\"nuevaPassword456\"}",
            "{\"passwordActual\":\"password123\",\"passwordNueva\":\"\"}",
            "{\"passwordActual\":\"password123\",\"passwordNueva\":\"12345\"}"})
    void rechazaCambioDePasswordConDatosInvalidos(String cuerpo) throws Exception {
        Usuario usuario = usuario();
        String hashOriginal = usuario.getPasswordHash();

        cambiarPassword(usuario, cuerpo)
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));

        assertThat(recargar(usuario).getPasswordHash()).isEqualTo(hashOriginal);
    }
}
