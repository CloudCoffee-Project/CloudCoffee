package cl.cloudcoffee.auth_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import javax.sql.DataSource;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.fasterxml.jackson.databind.ObjectMapper;

import cl.cloudcoffee.auth_service.repository.AsignacionCafeteriaRepository;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.security.testing.JwtTestSupport;

/** INT2-65: las cuentas de prueba inician sesión y reciben rol y cafetería desde Auth. */
// Base propia: en CI las demás pruebas comparten un PostgreSQL sin datos de prueba.
@SpringBootTest(properties = {
        "spring.rabbitmq.listener.simple.auto-startup=false",
        "spring.datasource.url=jdbc:h2:mem:dev-auth-seed;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password="
})
@AutoConfigureMockMvc
@ActiveProfiles("dev")
class DevAccountsSeedIntegrationTests extends JwtTestSupport {

    static final String SEED = "db/seed/dev/R__seed_usuarios_desarrollo.sql";
    static final String PASSWORD = "CafeDemo123!";
    static final String CENTRAL = "44444444-4444-4444-8444-444444444444";
    static final String PATIO_NORTE = "44444444-4444-4444-8444-444444444447";

    @DynamicPropertySource
    static void privateKey(DynamicPropertyRegistry registry) {
        registry.add("JWT_PRIVATE_KEY_LOCATION", () -> PRIVATE_KEY_LOCATION);
    }

    @MockitoBean
    RabbitTemplate rabbitTemplate;

    @Autowired MockMvc mvc;
    @Autowired JwtDecoder decoder;
    @Autowired DataSource dataSource;
    @Autowired UsuarioRepository usuarios;
    @Autowired AsignacionCafeteriaRepository asignaciones;

    final ObjectMapper mapper = new ObjectMapper();

    @ParameterizedTest
    @CsvSource({
            "cajero.central@cloudcoffee.dev, CAJERO, " + CENTRAL,
            "admin.central@cloudcoffee.dev, ADMIN_CAFETERIA, " + CENTRAL,
            "cajero.patio@cloudcoffee.dev, CAJERO, " + PATIO_NORTE,
            "admin.patio@cloudcoffee.dev, ADMIN_CAFETERIA, " + PATIO_NORTE
    })
    void personalDeDosCafeteriasRecibeSuCafeteriaEnElJwt(String email, String rol, String cafeteriaId) throws Exception {
        Jwt jwt = login(email);

        assertThat(jwt.getClaimAsString("role")).isEqualTo(rol);
        assertThat(jwt.getClaimAsString("cafeteriaId")).isEqualTo(cafeteriaId);
    }

    @Test
    void compradorRecibeRolClienteSinCafeteria() throws Exception {
        Jwt jwt = login("comprador@cloudcoffee.dev");

        assertThat(jwt.getClaimAsString("role")).isEqualTo("CLIENTE");
        assertThat(jwt.getClaims()).doesNotContainKey("cafeteriaId");
    }

    @Test
    void cajeroSinAsignacionRecibeTokenSinCafeteria() throws Exception {
        Jwt jwt = login("cajero.sinasignar@cloudcoffee.dev");

        assertThat(jwt.getClaimAsString("role")).isEqualTo("CAJERO");
        assertThat(jwt.getClaims()).doesNotContainKey("cafeteriaId");
    }

    @Test
    void seedEsIdempotente() throws Exception {
        long totalUsuarios = usuarios.count();

        new ResourceDatabasePopulator(new ClassPathResource(SEED)).execute(dataSource);

        assertThat(usuarios.count()).isEqualTo(totalUsuarios);
        assertThat(asignaciones.count()).isEqualTo(4);
        assertThat(login("cajero.central@cloudcoffee.dev").getClaimAsString("cafeteriaId")).isEqualTo(CENTRAL);
    }

    private Jwt login(String email) throws Exception {
        String body = mvc.perform(post("/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\": \"%s\", \"password\": \"%s\"}".formatted(email, PASSWORD)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return decoder.decode(mapper.readTree(body).get("accessToken").asText());
    }
}
