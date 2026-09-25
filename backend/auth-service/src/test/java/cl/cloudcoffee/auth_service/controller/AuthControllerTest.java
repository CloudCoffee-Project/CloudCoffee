package cl.cloudcoffee.auth_service.controller;

import cl.cloudcoffee.security.testing.JwtTestSupport;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.DynamicPropertyRegistry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import cl.cloudcoffee.auth_service.messaging.AuthEventPublisher;
import cl.cloudcoffee.auth_service.messaging.CloudCoffeeEvent;

@SpringBootTest(properties = "spring.rabbitmq.listener.simple.auto-startup=false")
@AutoConfigureMockMvc
class AuthControllerTest extends JwtTestSupport {

    @DynamicPropertySource
    static void privateKey(DynamicPropertyRegistry registry) {
        registry.add("JWT_PRIVATE_KEY_LOCATION", () -> PRIVATE_KEY_LOCATION);
    }

    @Autowired
    private MockMvc mvc;

    @Autowired
    private JwtDecoder jwtDecoder;

    private final ObjectMapper objectMapper = new ObjectMapper();

    // Sin broker real disponible en el entorno de test; se reemplaza para no depender de infraestructura externa.
    @MockitoBean
    private RabbitTemplate rabbitTemplate;

    /** Recupera el token en texto plano del último evento de verificación publicado para ese correo. */
    private String capturarTokenVerificacionPublicado(String email) {
        ArgumentCaptor<CloudCoffeeEvent> captor = ArgumentCaptor.forClass(CloudCoffeeEvent.class);
        verify(rabbitTemplate, atLeastOnce()).convertAndSend(
                anyString(), eq(AuthEventPublisher.SOLICITUD_VERIFICACION_CORREO_EVENT), captor.capture());

        return captor.getAllValues().stream()
                .filter(evento -> email.equals(evento.payload().get("email")))
                .reduce((first, second) -> second)
                .map(evento -> (String) evento.payload().get("token"))
                .orElseThrow();
    }

    private static String verificarJson(String token) {
        return "{\"token\": \"%s\"}".formatted(token);
    }

    private static String reenviarJson(String email) {
        return "{\"email\": \"%s\"}".formatted(email);
    }

    private static String registroJson(String email) {
        return """
                {
                  "email": "%s",
                  "password": "password123",
                  "nombre": "Ana",
                  "apellido": "Pérez",
                  "telefono": "+56912345678"
                }
                """.formatted(email);
    }

    private static String loginJson(String email, String password) {
        return "{\"email\": \"%s\", \"password\": \"%s\"}".formatted(email, password);
    }

    /** Registra un cliente con la contraseña estándar de las pruebas y confirma su correo. */
    private void registrarYVerificarCliente(String email) throws Exception {
        mvc.perform(post("/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registroJson(email)))
                .andExpect(status().isCreated());

        String token = capturarTokenVerificacionPublicado(email);

        mvc.perform(post("/auth/verificacion")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(verificarJson(token)))
                .andExpect(status().isOk());
    }

    @Test
    void registraUnClienteNuevo() throws Exception {
        mvc.perform(post("/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registroJson("nuevo-cliente@cloudcoffee.cl")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.email").value("nuevo-cliente@cloudcoffee.cl"))
                .andExpect(jsonPath("$.rol").value("CLIENTE"))
                .andExpect(jsonPath("$.verificado").value(false))
                .andExpect(jsonPath("$.id").isNotEmpty())
                .andExpect(jsonPath("$.password").doesNotExist());
    }

    @Test
    void rechazaEmailDuplicado() throws Exception {
        String json = registroJson("duplicado@cloudcoffee.cl");

        mvc.perform(post("/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json))
                .andExpect(status().isCreated());

        mvc.perform(post("/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json))
                .andExpect(status().isConflict())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.status").value(409))
                .andExpect(jsonPath("$.detail").isNotEmpty());
    }

    @Test
    void rechazaDatosObligatoriosFaltantes() throws Exception {
        String requestInvalido = """
                {
                  "email": "no-es-un-correo",
                  "password": "123",
                  "nombre": "",
                  "apellido": "",
                  "telefono": ""
                }
                """;

        mvc.perform(post("/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestInvalido))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.errors").isArray());
    }

    @Test
    void flujoDeVerificacionCompleto() throws Exception {
        String email = "verificar@cloudcoffee.cl";
        mvc.perform(post("/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registroJson(email)))
                .andExpect(status().isCreated());

        String token = capturarTokenVerificacionPublicado(email);

        mvc.perform(post("/auth/verificacion")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(verificarJson(token)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(email))
                .andExpect(jsonPath("$.verificado").value(true));
    }

    @Test
    void rechazaTokenDeVerificacionInvalido() throws Exception {
        mvc.perform(post("/auth/verificacion")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(verificarJson("token-que-no-existe")))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.status").value(400));
    }

    @Test
    void rechazaVerificarDosVecesConElMismoToken() throws Exception {
        String email = "verificar-dos-veces@cloudcoffee.cl";
        mvc.perform(post("/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registroJson(email)))
                .andExpect(status().isCreated());

        String token = capturarTokenVerificacionPublicado(email);

        mvc.perform(post("/auth/verificacion")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(verificarJson(token)))
                .andExpect(status().isOk());

        mvc.perform(post("/auth/verificacion")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(verificarJson(token)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void reenvioDeVerificacionPermiteVerificarConElNuevoToken() throws Exception {
        String email = "reenviar@cloudcoffee.cl";
        mvc.perform(post("/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registroJson(email)))
                .andExpect(status().isCreated());

        mvc.perform(post("/auth/verificacion/reenviar")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(reenviarJson(email)))
                .andExpect(status().isAccepted());

        String token = capturarTokenVerificacionPublicado(email);

        mvc.perform(post("/auth/verificacion")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(verificarJson(token)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verificado").value(true));
    }

    @Test
    void reenvioDeVerificacionNoCreaUnSegundoUsuario() throws Exception {
        String email = "sin-duplicar@cloudcoffee.cl";
        mvc.perform(post("/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registroJson(email)))
                .andExpect(status().isCreated());

        mvc.perform(post("/auth/verificacion/reenviar")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(reenviarJson(email)))
                .andExpect(status().isAccepted());

        // El correo sigue perteneciendo a un único usuario: un segundo registro con el mismo email es rechazado.
        mvc.perform(post("/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registroJson(email)))
                .andExpect(status().isConflict());
    }

    @Test
    void rechazaReenvioParaEmailInexistente() throws Exception {
        mvc.perform(post("/auth/verificacion/reenviar")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(reenviarJson("no-registrado@cloudcoffee.cl")))
                .andExpect(status().isNotFound());
    }

    @Test
    void loginExitosoRetornaAccessTokenRs256ConRolYRefreshToken() throws Exception {
        String email = "login-exitoso@cloudcoffee.cl";
        registrarYVerificarCliente(email);

        String body = mvc.perform(post("/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginJson(email, "password123")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.refreshToken").isNotEmpty())
                .andReturn().getResponse().getContentAsString();

        JsonNode json = objectMapper.readTree(body);
        Jwt jwt = jwtDecoder.decode(json.get("accessToken").asText());
        assertThatJwt(jwt);
    }

    private static void assertThatJwt(Jwt jwt) {
        assertThat(jwt.getHeaders().get("alg")).isEqualTo("RS256");
        assertThat(jwt.getClaimAsString("role")).isEqualTo("CLIENTE");
        assertThat(jwt.getExpiresAt()).isEqualTo(jwt.getIssuedAt().plus(Duration.ofMinutes(15)));
    }

    @Test
    void loginRechazaCredencialesInvalidas() throws Exception {
        String email = "login-password-incorrecto@cloudcoffee.cl";
        registrarYVerificarCliente(email);

        mvc.perform(post("/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginJson(email, "password-incorrecto")))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
    }

    @Test
    void loginRechazaEmailInexistente() throws Exception {
        mvc.perform(post("/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginJson("no-registrado@cloudcoffee.cl", "password123")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void loginRechazaCuentaNoVerificadaConErrorEspecifico() throws Exception {
        String email = "login-sin-verificar@cloudcoffee.cl";
        mvc.perform(post("/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registroJson(email)))
                .andExpect(status().isCreated());

        mvc.perform(post("/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginJson(email, "password123")))
                .andExpect(status().isForbidden())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.type").value("/problems/cuenta-no-verificada"));
    }

    @Test
    void cadaLoginEmiteUnRefreshTokenDistintoParaSesionesIndependientesPorDispositivo() throws Exception {
        String email = "login-multi-dispositivo@cloudcoffee.cl";
        registrarYVerificarCliente(email);

        String primeraRespuesta = mvc.perform(post("/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginJson(email, "password123")))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        String segundaRespuesta = mvc.perform(post("/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginJson(email, "password123")))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        String primerRefreshToken = objectMapper.readTree(primeraRespuesta).get("refreshToken").asText();
        String segundoRefreshToken = objectMapper.readTree(segundaRespuesta).get("refreshToken").asText();

        assertThat(primerRefreshToken).isNotEqualTo(segundoRefreshToken);
    }
}
