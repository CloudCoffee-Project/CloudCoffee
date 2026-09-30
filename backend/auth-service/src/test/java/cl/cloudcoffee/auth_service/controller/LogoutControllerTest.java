package cl.cloudcoffee.auth_service.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

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

import cl.cloudcoffee.auth_service.dto.LoginResponse;
import cl.cloudcoffee.auth_service.model.Rol;
import cl.cloudcoffee.auth_service.model.TipoToken;
import cl.cloudcoffee.auth_service.model.TokenAuth;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.TokenAuthRepository;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.auth_service.service.LoginService;
import cl.cloudcoffee.auth_service.service.JwtTokenService;
import cl.cloudcoffee.security.testing.JwtTestSupport;

import com.fasterxml.jackson.databind.ObjectMapper;

@SpringBootTest(properties = "spring.rabbitmq.listener.simple.auto-startup=false")
@AutoConfigureMockMvc
class LogoutControllerTest extends JwtTestSupport {

    @DynamicPropertySource
    static void privateKey(DynamicPropertyRegistry registry) {
        registry.add("JWT_PRIVATE_KEY_LOCATION", () -> PRIVATE_KEY_LOCATION);
    }

    @Autowired private MockMvc mvc;
    @Autowired private UsuarioRepository usuarios;
    @Autowired private TokenAuthRepository tokens;
    @Autowired private JwtTokenService jwtTokenService;
    @Autowired private LoginService loginService;
    @Autowired private PasswordEncoder passwordEncoder;
    @MockitoBean private RabbitTemplate rabbitTemplate;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private Usuario usuario() {
        Usuario usuario = new Usuario(UUID.randomUUID() + "@cloudcoffee.cl",
                passwordEncoder.encode("password123"), Rol.CLIENTE, "Ana", "Pérez", "+56912345678");
        usuario.verificar();
        return usuarios.saveAndFlush(usuario);
    }

    private LoginResponse iniciarSesion(Usuario usuario) {
        return loginService.iniciarSesion(usuario.getEmail(), "password123");
    }

    private static String cuerpo(String refreshToken) {
        return "{\"refreshToken\":\"%s\"}".formatted(refreshToken);
    }

    private ResultActions logout(LoginResponse sesion) throws Exception {
        return mvc.perform(post("/auth/logout")
                .header("Authorization", "Bearer " + sesion.accessToken())
                .contentType(MediaType.APPLICATION_JSON).content(cuerpo(sesion.refreshToken())));
    }

    private ResultActions refresh(String refreshToken) throws Exception {
        return mvc.perform(post("/auth/refresh")
                .contentType(MediaType.APPLICATION_JSON).content(cuerpo(refreshToken)));
    }

    private static String hash(String token) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(token.getBytes(StandardCharsets.UTF_8)));
    }

    private TokenAuth tokenPersistido(String refreshToken) throws Exception {
        return tokens.findByTokenHashAndTipo(hash(refreshToken), TipoToken.REFRESH).orElseThrow();
    }

    @Test
    void requiereJwtYNoRevocaLaSesionAnonima() throws Exception {
        LoginResponse sesion = iniciarSesion(usuario());

        mvc.perform(post("/auth/logout").contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo(sesion.refreshToken())))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));

        assertThat(tokenPersistido(sesion.refreshToken()).estaVigente()).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"malformed", "expired", "wrong-key", "tampered"})
    void rechazaJwtInvalidoSinRevocar(String tipo) throws Exception {
        LoginResponse sesion = iniciarSesion(usuario());

        mvc.perform(post("/auth/logout").header("Authorization", "Bearer " + invalidToken(tipo))
                        .contentType(MediaType.APPLICATION_JSON).content(cuerpo(sesion.refreshToken())))
                .andExpect(status().isUnauthorized());

        assertThat(tokenPersistido(sesion.refreshToken()).estaVigente()).isTrue();
    }

    @Test
    void revocaLaSesionYRechazaLaReutilizacionDelRefreshToken() throws Exception {
        LoginResponse sesion = iniciarSesion(usuario());

        logout(sesion).andExpect(status().isNoContent()).andExpect(content().string(""));

        assertThat(tokenPersistido(sesion.refreshToken()).getRevokedAt()).isNotNull();
        refresh(sesion.refreshToken()).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("/problems/refresh-token-invalido"));
    }

    @Test
    void conservaLasSesionesDeOtrosDispositivos() throws Exception {
        Usuario usuario = usuario();
        LoginResponse dispositivoA = iniciarSesion(usuario);
        LoginResponse dispositivoB = iniciarSesion(usuario);

        logout(dispositivoA).andExpect(status().isNoContent());

        assertThat(tokenPersistido(dispositivoB.refreshToken()).estaVigente()).isTrue();
        refresh(dispositivoB.refreshToken()).andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.refreshToken").isNotEmpty());
    }

    @Test
    void logoutRepetidoConservaLaRevocacionYNoCreaTokens() throws Exception {
        LoginResponse sesion = iniciarSesion(usuario());
        long cantidad = tokens.count();
        logout(sesion).andExpect(status().isNoContent());
        Instant revokedAt = tokenPersistido(sesion.refreshToken()).getRevokedAt();

        logout(sesion).andExpect(status().isNoContent());

        assertThat(tokens.count()).isEqualTo(cantidad);
        assertThat(tokenPersistido(sesion.refreshToken()).getRevokedAt()).isEqualTo(revokedAt);
        refresh(sesion.refreshToken()).andExpect(status().isUnauthorized());
    }

    @Test
    void logoutConcurrenteEsIdempotente() throws Exception {
        LoginResponse sesion = iniciarSesion(usuario());
        long cantidad = tokens.count();
        CountDownLatch inicio = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var primero = executor.submit(() -> {
                inicio.await();
                return logout(sesion).andReturn().getResponse().getStatus();
            });
            var segundo = executor.submit(() -> {
                inicio.await();
                return logout(sesion).andReturn().getResponse().getStatus();
            });
            inicio.countDown();
            assertThat(primero.get(10, TimeUnit.SECONDS)).isEqualTo(204);
            assertThat(segundo.get(10, TimeUnit.SECONDS)).isEqualTo(204);
        }
        assertThat(tokenPersistido(sesion.refreshToken()).estaVigente()).isFalse();
        assertThat(tokens.count()).isEqualTo(cantidad);
        refresh(sesion.refreshToken()).andExpect(status().isUnauthorized());
    }

    @Test
    void unUsuarioNoPuedeCerrarLaSesionDeOtro() throws Exception {
        LoginResponse atacante = iniciarSesion(usuario());
        LoginResponse otraSesion = iniciarSesion(usuario());

        logout(new LoginResponse(atacante.accessToken(), otraSesion.refreshToken()))
                .andExpect(status().isUnauthorized());

        assertThat(tokenPersistido(otraSesion.refreshToken()).estaVigente()).isTrue();
        assertThat(tokenPersistido(atacante.refreshToken()).estaVigente()).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"refreshToken\":null}", "{\"refreshToken\":\"\"}",
            "{\"refreshToken\":\"   \"}"})
    void exigeRefreshTokenSinRevocarOtrasSesiones(String cuerpo) throws Exception {
        LoginResponse sesion = iniciarSesion(usuario());

        mvc.perform(post("/auth/logout").header("Authorization", "Bearer " + sesion.accessToken())
                        .contentType(MediaType.APPLICATION_JSON).content(cuerpo))
                .andExpect(status().isBadRequest());

        assertThat(tokenPersistido(sesion.refreshToken()).estaVigente()).isTrue();
    }

    @Test
    void rechazaTokenInexistenteYTokenDeVerificacion() throws Exception {
        Usuario usuario = usuario();
        String tokenVerificacion = UUID.randomUUID().toString();
        TokenAuth verificacion = tokens.saveAndFlush(new TokenAuth(usuario, hash(tokenVerificacion),
                Instant.now().plusSeconds(3600), TipoToken.VERIFICACION_CORREO));
        String jwt = jwtTokenService.emitir(usuario);

        logout(new LoginResponse(jwt, "inexistente")).andExpect(status().isUnauthorized());
        logout(new LoginResponse(jwt, tokenVerificacion)).andExpect(status().isUnauthorized());

        assertThat(tokens.findById(verificacion.getId()).orElseThrow().estaVigente()).isTrue();
    }

    @Test
    void cierraLaSesionDespuesDeRotarElRefreshToken() throws Exception {
        LoginResponse sesion = iniciarSesion(usuario());
        String respuesta = refresh(sesion.refreshToken()).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        var json = objectMapper.readTree(respuesta);
        LoginResponse renovada = new LoginResponse(json.get("accessToken").asText(),
                json.get("refreshToken").asText());

        logout(renovada).andExpect(status().isNoContent());

        refresh(sesion.refreshToken()).andExpect(status().isUnauthorized());
        refresh(renovada.refreshToken()).andExpect(status().isUnauthorized());
        logout(renovada).andExpect(status().isNoContent());
    }
}
