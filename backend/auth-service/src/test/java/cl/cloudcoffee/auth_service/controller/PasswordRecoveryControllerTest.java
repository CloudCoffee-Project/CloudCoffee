package cl.cloudcoffee.auth_service.controller;

import cl.cloudcoffee.auth_service.messaging.AuthEventPublisher;
import cl.cloudcoffee.auth_service.messaging.CloudCoffeeEvent;
import cl.cloudcoffee.auth_service.model.TipoToken;
import cl.cloudcoffee.auth_service.model.TokenAuth;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.TokenAuthRepository;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "spring.rabbitmq.listener.simple.auto-startup=false")
@AutoConfigureMockMvc
class PasswordRecoveryControllerTest extends JwtTestSupport {

    @DynamicPropertySource
    static void privateKey(DynamicPropertyRegistry registry) {
        registry.add("JWT_PRIVATE_KEY_LOCATION", () -> PRIVATE_KEY_LOCATION);
    }

    @Autowired MockMvc mvc;
    private final ObjectMapper objectMapper = new ObjectMapper();
    @Autowired UsuarioRepository usuarioRepository;
    @Autowired TokenAuthRepository tokenAuthRepository;
    @Autowired PasswordEncoder passwordEncoder;

    @MockitoBean RabbitTemplate rabbitTemplate;

    private String ultimoToken(String routingKey, String email) {
        ArgumentCaptor<CloudCoffeeEvent> captor = ArgumentCaptor.forClass(CloudCoffeeEvent.class);
        verify(rabbitTemplate, atLeastOnce()).convertAndSend(anyString(), eq(routingKey), captor.capture());
        return captor.getAllValues().stream()
                .filter(evento -> email.equals(evento.payload().get("email")))
                .reduce((a, b) -> b)
                .map(evento -> (String) evento.payload().get("token"))
                .orElseThrow();
    }

    private String registrarYVerificar() throws Exception {
        String email = "recuperacion-" + UUID.randomUUID() + "@cloudcoffee.cl";
        mvc.perform(post("/auth/register").contentType(MediaType.APPLICATION_JSON).content("""
                {"email":"%s","password":"password123","nombre":"Ana",\
                 "apellido":"Pérez","telefono":"+56912345678"}
                """.formatted(email))).andExpect(status().isCreated());
        String verificationToken = ultimoToken(AuthEventPublisher.SOLICITUD_VERIFICACION_CORREO_EVENT, email);
        mvc.perform(post("/auth/verificacion").contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"" + verificationToken + "\"}"))
                .andExpect(status().isOk());
        return email;
    }

    private String solicitarRecuperacion(String email) throws Exception {
        mvc.perform(post("/auth/password/recovery").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\"}"))
                .andExpect(status().isAccepted());
        return ultimoToken(AuthEventPublisher.SOLICITUD_RECUPERACION_PASSWORD_EVENT, email);
    }

    private ResultActions reset(String token, String nuevaPassword) throws Exception {
        return mvc.perform(post("/auth/password/reset").contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"" + token + "\",\"nuevaPassword\":\"" + nuevaPassword + "\"}"));
    }

    private void verificarQueNoSePublicoRecuperacion() {
        verify(rabbitTemplate, never()).convertAndSend(anyString(),
                eq(AuthEventPublisher.SOLICITUD_RECUPERACION_PASSWORD_EVENT), any(Object.class));
    }

    private String passwordHash(String email) {
        return usuarioRepository.findByEmail(email).orElseThrow().getPasswordHash();
    }

    @Test
    void recoveryNoRevelaSiExisteElCorreoYGuardaSoloElHash() throws Exception {
        String email = registrarYVerificar();
        mvc.perform(post("/auth/password/recovery").contentType(MediaType.APPLICATION_JSON)
                .header("X-Trace-Id", "trace-recovery")
                .content("{\"email\":\"" + email.toUpperCase() + "\"}"))
                .andExpect(status().isAccepted());

        String token = ultimoToken(AuthEventPublisher.SOLICITUD_RECUPERACION_PASSWORD_EVENT, email);
        Usuario usuario = usuarioRepository.findByEmail(email).orElseThrow();
        TokenAuth almacenado = tokenAuthRepository.findByTokenHashAndTipo(
                sha256(token), TipoToken.RECUPERACION_PASSWORD).orElseThrow();
        assertThat(almacenado.getUsuario().getId()).isEqualTo(usuario.getId());
        assertThat(almacenado.getTokenHash()).isNotEqualTo(token);
        assertThat(almacenado.getExpiresAt()).isAfter(Instant.now().plusSeconds(3500));

        mvc.perform(post("/auth/password/recovery").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\"}"))
                .andExpect(status().isAccepted());
        assertThat(tokenAuthRepository.findByTokenHashAndTipo(
                sha256(token), TipoToken.RECUPERACION_PASSWORD).orElseThrow().estaVigente()).isFalse();

        mvc.perform(post("/auth/password/recovery").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"desconocido-" + UUID.randomUUID() + "@cloudcoffee.cl\"}"))
                .andExpect(status().isAccepted());
    }

    @Test
    void resetCambiaPasswordRevocaRefreshYNoPermiteReutilizarToken() throws Exception {
        String email = registrarYVerificar();
        JsonNode login = objectMapper.readTree(mvc.perform(post("/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"password\":\"password123\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        String refreshToken = login.get("refreshToken").asText();

        mvc.perform(post("/auth/password/recovery").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\"}"))
                .andExpect(status().isAccepted());
        String token = ultimoToken(AuthEventPublisher.SOLICITUD_RECUPERACION_PASSWORD_EVENT, email);

        String resetBody = "{\"token\":\"" + token + "\",\"nuevaPassword\":\"nuevoPassword123\"}";
        mvc.perform(post("/auth/password/reset").contentType(MediaType.APPLICATION_JSON)
                .content(resetBody)).andExpect(status().isNoContent());

        assertThat(passwordEncoder.matches("nuevoPassword123",
                usuarioRepository.findByEmail(email).orElseThrow().getPasswordHash())).isTrue();
        mvc.perform(post("/auth/password/reset").contentType(MediaType.APPLICATION_JSON)
                .content(resetBody)).andExpect(status().isBadRequest());
        mvc.perform(post("/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                .content("{\"refreshToken\":\"" + refreshToken + "\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"password\":\"password123\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"password\":\"nuevoPassword123\"}"))
                .andExpect(status().isOk());
    }

    @Test
    void resetRechazaTokenInvalidoYExpirado() throws Exception {
        mvc.perform(post("/auth/password/reset").contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"inexistente\",\"nuevaPassword\":\"password123\"}"))
                .andExpect(status().isBadRequest());

        String email = registrarYVerificar();
        Usuario usuario = usuarioRepository.findByEmail(email).orElseThrow();
        tokenAuthRepository.save(new TokenAuth(usuario, sha256("expirado"),
                Instant.now().minusSeconds(1), TipoToken.RECUPERACION_PASSWORD));
        mvc.perform(post("/auth/password/reset").contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"expirado\",\"nuevaPassword\":\"password123\"}"))
                .andExpect(status().isBadRequest());
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"email\":\"\"}", "{\"email\":\"no-es-un-correo\"}"})
    void recoveryExigeUnCorreoValidoYNoPublicaEventos(String cuerpo) throws Exception {
        mvc.perform(post("/auth/password/recovery").contentType(MediaType.APPLICATION_JSON).content(cuerpo))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors").isArray());

        verificarQueNoSePublicoRecuperacion();
    }

    @Test
    void recoveryParaCorreoDesconocidoRespondeIgualPeroNoGeneraToken() throws Exception {
        long cantidad = tokenAuthRepository.count();

        mvc.perform(post("/auth/password/recovery").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"desconocido-" + UUID.randomUUID() + "@cloudcoffee.cl\"}"))
                .andExpect(status().isAccepted());

        verificarQueNoSePublicoRecuperacion();
        assertThat(tokenAuthRepository.count()).isEqualTo(cantidad);
    }

    @Test
    void recoveryParaCuentaDesactivadaNoGeneraToken() throws Exception {
        String email = registrarYVerificar();
        Usuario usuario = usuarioRepository.findByEmail(email).orElseThrow();
        usuario.desactivar();
        usuarioRepository.saveAndFlush(usuario);
        long cantidad = tokenAuthRepository.count();

        mvc.perform(post("/auth/password/recovery").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\"}"))
                .andExpect(status().isAccepted());

        verificarQueNoSePublicoRecuperacion();
        assertThat(tokenAuthRepository.count()).isEqualTo(cantidad);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "1234567"})
    void resetRechazaPasswordInvalidaSinConsumirElToken(String nuevaPassword) throws Exception {
        String email = registrarYVerificar();
        String token = solicitarRecuperacion(email);
        String hashOriginal = passwordHash(email);

        reset(token, nuevaPassword)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors").isArray());

        assertThat(passwordHash(email)).isEqualTo(hashOriginal);
        reset(token, "nuevoPassword123").andExpect(status().isNoContent());
    }

    @ParameterizedTest
    @ValueSource(strings = {"{\"nuevaPassword\":\"nuevoPassword123\"}",
            "{\"token\":\"\",\"nuevaPassword\":\"nuevoPassword123\"}",
            "{\"token\":\"   \",\"nuevaPassword\":\"nuevoPassword123\"}"})
    void resetExigeToken(String cuerpo) throws Exception {
        mvc.perform(post("/auth/password/reset").contentType(MediaType.APPLICATION_JSON).content(cuerpo))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors").isArray());
    }

    @Test
    void resetRechazaTokenReemplazadoPorUnaSolicitudPosterior() throws Exception {
        String email = registrarYVerificar();
        String tokenAnterior = solicitarRecuperacion(email);
        String tokenVigente = solicitarRecuperacion(email);
        String hashOriginal = passwordHash(email);

        reset(tokenAnterior, "nuevoPassword123")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("/problems/token-recuperacion-invalido"));
        assertThat(passwordHash(email)).isEqualTo(hashOriginal);

        reset(tokenVigente, "nuevoPassword123").andExpect(status().isNoContent());
    }

    @Test
    void resetNoAceptaTokensDeOtroTipo() throws Exception {
        String email = registrarYVerificar();
        Usuario usuario = usuarioRepository.findByEmail(email).orElseThrow();
        String hashOriginal = usuario.getPasswordHash();
        String refreshPlano = "refresh-" + UUID.randomUUID();
        String verificacionPlano = "verificacion-" + UUID.randomUUID();
        TokenAuth refresh = tokenAuthRepository.saveAndFlush(new TokenAuth(usuario, sha256(refreshPlano),
                Instant.now().plusSeconds(3600), TipoToken.REFRESH));
        tokenAuthRepository.saveAndFlush(new TokenAuth(usuario, sha256(verificacionPlano),
                Instant.now().plusSeconds(3600), TipoToken.VERIFICACION_CORREO));

        reset(refreshPlano, "nuevoPassword123").andExpect(status().isBadRequest());
        reset(verificacionPlano, "nuevoPassword123").andExpect(status().isBadRequest());

        assertThat(passwordHash(email)).isEqualTo(hashOriginal);
        assertThat(tokenAuthRepository.findById(refresh.getId()).orElseThrow().estaVigente()).isTrue();
    }

    @Test
    void resetRechazaCuentaDesactivadaDespuesDeEmitirElToken() throws Exception {
        String email = registrarYVerificar();
        String token = solicitarRecuperacion(email);
        Usuario usuario = usuarioRepository.findByEmail(email).orElseThrow();
        String hashOriginal = usuario.getPasswordHash();
        usuario.desactivar();
        usuarioRepository.saveAndFlush(usuario);

        reset(token, "nuevoPassword123")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("/problems/token-recuperacion-invalido"));

        assertThat(passwordHash(email)).isEqualTo(hashOriginal);
    }


    private static String sha256(String token) {
        try {
            byte[] bytes = java.security.MessageDigest.getInstance("SHA-256")
                    .digest(token.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(bytes);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
