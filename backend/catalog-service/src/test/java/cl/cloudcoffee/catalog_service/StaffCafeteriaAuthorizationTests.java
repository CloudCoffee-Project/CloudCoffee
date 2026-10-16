package cl.cloudcoffee.catalog_service;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jwt.JWTClaimsSet;

import cl.cloudcoffee.security.testing.JwtTestSupport;

/**
 * INT2-65: el personal solo consulta la cafetería que Auth le asignó en el JWT.
 * Usa el seed de catálogo (INT2-36), con la misma configuración que DevCatalogSeedIntegrationTests.
 */
@SpringBootTest(properties = {
        "management.tracing.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:dev-catalog-seed;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password="
})
@AutoConfigureMockMvc
@ActiveProfiles("dev")
class StaffCafeteriaAuthorizationTests extends JwtTestSupport {

    static final String CENTRAL = "44444444-4444-4444-8444-444444444444";
    static final String PATIO_NORTE = "44444444-4444-4444-8444-444444444447";

    @Autowired
    MockMvc mvc;

    @ParameterizedTest
    @ValueSource(strings = {"CAJERO", "ADMIN_CAFETERIA"})
    void personalConsultaElInventarioDeSuCafeteria(String role) throws Exception {
        inventario(CENTRAL, staff(role, CENTRAL))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(7)))
                .andExpect(jsonPath("$[*].productoNombre", contains(
                        "Agua mineral", "Café americano", "Cappuccino", "Frappé moca",
                        "Latte de vainilla", "Medialuna", "Sándwich ave palta")))
                // A diferencia del catálogo público, el personal ve también lo agotado.
                .andExpect(jsonPath("$[0].estado").value("OUT_OF_STOCK"))
                .andExpect(jsonPath("$[0].stock").value(0));
    }

    @ParameterizedTest
    @ValueSource(strings = {"CAJERO", "ADMIN_CAFETERIA"})
    void personalNoConsultaUnaCafeteriaAjena(String role) throws Exception {
        prohibido(inventario(PATIO_NORTE, staff(role, CENTRAL)));
    }

    @ParameterizedTest
    @ValueSource(strings = {"CAJERO", "ADMIN_CAFETERIA"})
    void personalSinAsignacionNoConsultaNingunaCafeteria(String role) throws Exception {
        prohibido(inventario(CENTRAL, sign(claims().claim("role", role).build())));
    }

    @Test
    void clienteNoConsultaInventarios() throws Exception {
        prohibido(inventario(CENTRAL, token()));
    }

    @Test
    void superAdminConsultaCualquierCafeteria() throws Exception {
        inventario(PATIO_NORTE, sign(claims().claim("role", "SUPER_ADMIN").build()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(5)));
    }

    @Test
    void ignoraCafeteriaYRolEnviadosPorElFrontend() throws Exception {
        // Solo cuenta el JWT firmado: encabezados y parámetros no amplían permisos.
        prohibido(mvc.perform(get("/catalog/cafeterias/{id}/ofertas", PATIO_NORTE)
                .header("Authorization", "Bearer " + staff("CAJERO", CENTRAL))
                .header("X-Cafeteria-Id", PATIO_NORTE)
                .header("X-User-Role", "SUPER_ADMIN")
                .param("cafeteriaId", PATIO_NORTE)
                .param("role", "SUPER_ADMIN")));
    }

    @Test
    void sinJwtResponde401() throws Exception {
        mvc.perform(get("/catalog/cafeterias/{id}/ofertas", CENTRAL))
                .andExpect(status().isUnauthorized());
    }

    private ResultActions inventario(String cafeteriaId, String jwt) throws Exception {
        return mvc.perform(get("/catalog/cafeterias/{id}/ofertas", cafeteriaId)
                .header("Authorization", "Bearer " + jwt));
    }

    private static void prohibido(ResultActions result) throws Exception {
        result.andExpect(status().isForbidden())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.status").value(403));
    }

    private static String staff(String role, String cafeteriaId) {
        return sign(claims().claim("role", role).claim("cafeteriaId", cafeteriaId).build());
    }

    private static String sign(JWTClaimsSet claims) {
        return JwtTestSupport.sign(claims, KEYS, JWSAlgorithm.RS256);
    }
}
