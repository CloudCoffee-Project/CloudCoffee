package cl.cloudcoffee.catalog_service;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasSize;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jwt.JWTClaimsSet;

import cl.cloudcoffee.security.AsignacionNoVerificableException;
import cl.cloudcoffee.security.AsignacionesCafeteria;
import cl.cloudcoffee.security.testing.JwtTestSupport;

/**
 * INT2-65 alineado con INT2-50: el personal solo consulta la cafetería que
 * auth-service tiene persistida para él; el claim cafeteriaId del JWT no autoriza.
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

    static final UUID CENTRAL = UUID.fromString("44444444-4444-4444-8444-444444444444");
    static final UUID PATIO_NORTE = UUID.fromString("44444444-4444-4444-8444-444444444447");

    static final UUID PERSONAL_CENTRAL = UUID.randomUUID();
    static final UUID PERSONAL_SIN_ASIGNACION = UUID.randomUUID();
    static final UUID PRODUCTO_AMERICANO = UUID.fromString("33333333-3333-4333-8333-333333333333");
    static final UUID OFERTA_AMERICANO_CENTRAL = UUID.fromString("55555555-5555-4555-8555-555555555501");

    @Autowired
    MockMvc mvc;

    // auth-service simulado: fuente de verdad de la asignación.
    @MockitoBean
    AsignacionesCafeteria asignaciones;
    @Autowired
    org.springframework.jdbc.core.JdbcTemplate jdbc;

    @BeforeEach
    void asignacionesPersistidas() {
        when(asignaciones.cafeteriaDe(any())).thenReturn(Optional.empty());
        when(asignaciones.cafeteriaDe(PERSONAL_CENTRAL)).thenReturn(Optional.of(CENTRAL));
    }

    @ParameterizedTest
    @ValueSource(strings = {"CAJERO", "ADMIN_CAFETERIA"})
    void personalConsultaElInventarioDeSuCafeteria(String role) throws Exception {
        inventario(CENTRAL, jwt(PERSONAL_CENTRAL, role, null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", hasSize(7)))
                .andExpect(jsonPath("$.content[*].productoNombre", contains(
                        "Agua mineral", "Café americano", "Cappuccino", "Frappé moca",
                        "Latte de vainilla", "Medialuna", "Sándwich ave palta")))
                // A diferencia del catálogo público, el personal ve también lo agotado.
                .andExpect(jsonPath("$.content[0].estado").value("OUT_OF_STOCK"))
                .andExpect(jsonPath("$.content[0].stock").value(0));
    }

    @ParameterizedTest
    @ValueSource(strings = {"CAJERO", "ADMIN_CAFETERIA"})
    void personalNoConsultaUnaCafeteriaAjena(String role) throws Exception {
        prohibido(inventario(PATIO_NORTE, jwt(PERSONAL_CENTRAL, role, null)));
    }

    @Test
    void elClaimDelJwtNoAmpliaNiReemplazaLaAsignacion() throws Exception {
        // Token emitido con Patio Norte, pero Auth tiene persistida Central.
        String token = jwt(PERSONAL_CENTRAL, "CAJERO", PATIO_NORTE);

        prohibido(inventario(PATIO_NORTE, token));
        inventario(CENTRAL, token).andExpect(status().isOk());
    }

    @ParameterizedTest
    @ValueSource(strings = {"CAJERO", "ADMIN_CAFETERIA"})
    void personalSinAsignacionNoConsultaNingunaAunqueSuTokenTraigaCafeteria(String role) throws Exception {
        prohibido(inventario(CENTRAL, jwt(PERSONAL_SIN_ASIGNACION, role, CENTRAL)));
    }

    @ParameterizedTest
    @ValueSource(strings = {"CLIENTE", "SUPER_ADMIN"})
    void rolesQueNoSonPersonalNoConsultanInventarios(String role) throws Exception {
        prohibido(inventario(CENTRAL, jwt(PERSONAL_CENTRAL, role, null)));
    }

    @Test
    void siAuthNoRespondeFallaCerrado() throws Exception {
        when(asignaciones.cafeteriaDe(PERSONAL_CENTRAL))
                .thenThrow(new AsignacionNoVerificableException("auth-service no responde", null));

        prohibido(inventario(CENTRAL, jwt(PERSONAL_CENTRAL, "CAJERO", CENTRAL)));
    }

    @Test
    void ignoraCafeteriaYRolEnviadosPorElFrontend() throws Exception {
        // Solo cuentan el JWT firmado y la asignación de Auth: encabezados y parámetros no amplían permisos.
        prohibido(mvc.perform(get("/catalog/cafeterias/{id}/ofertas", PATIO_NORTE)
                .header("Authorization", "Bearer " + jwt(PERSONAL_CENTRAL, "CAJERO", null))
                .header("X-Cafeteria-Id", PATIO_NORTE.toString())
                .header("X-User-Role", "SUPER_ADMIN")
                .param("cafeteriaId", PATIO_NORTE.toString())
                .param("role", "SUPER_ADMIN")));
    }

    @Test
    void sinJwtResponde401() throws Exception {
        mvc.perform(get("/catalog/cafeterias/{id}/ofertas", CENTRAL))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void adminOnlyManageAssignedOfferAndWithdrawalDoesNotReactivateStock() throws Exception {
        String admin = jwt(PERSONAL_CENTRAL, "ADMIN_CAFETERIA", null);

        mvc.perform(post("/catalog/cafeterias/{cafeteriaId}/ofertas", CENTRAL)
                        .header("Authorization", "Bearer " + admin)
                        .header("Idempotency-Key", UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productoId\":\"" + PRODUCTO_AMERICANO + "\",\"precio\":1800,\"stockInicial\":5}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("OFERTA_EXISTENTE"));

        mvc.perform(post("/catalog/cafeterias/{cafeteriaId}/ofertas", PATIO_NORTE)
                        .header("Authorization", "Bearer " + admin)
                        .header("Idempotency-Key", UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productoId\":\"" + PRODUCTO_AMERICANO + "\",\"precio\":1800,\"stockInicial\":5}"))
                .andExpect(status().isForbidden());

        mvc.perform(patch("/catalog/cafeterias/{cafeteriaId}/ofertas/{ofertaId}", CENTRAL, OFERTA_AMERICANO_CENTRAL)
                        .header("Authorization", "Bearer " + admin)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"precio\":1900,\"version\":4}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.precio").value(1900))
                .andExpect(jsonPath("$.activa").value(true));

        mvc.perform(post("/catalog/cafeterias/{cafeteriaId}/ofertas/{ofertaId}/baja", CENTRAL, OFERTA_AMERICANO_CENTRAL)
                        .header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.activa").value(false));

        jdbc.update("UPDATE offer SET stock = stock + 1 WHERE id = ?", OFERTA_AMERICANO_CENTRAL);
        mvc.perform(get("/catalog/cafeterias/{cafeteriaId}/ofertas", CENTRAL)
                        .header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.id=='" + OFERTA_AMERICANO_CENTRAL + "')].activa").value(false));

        mvc.perform(post("/catalog/cafeterias/{cafeteriaId}/ofertas/{ofertaId}/reactivar", CENTRAL, OFERTA_AMERICANO_CENTRAL)
                        .header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.activa").value(true));
    }

    private ResultActions inventario(UUID cafeteriaId, String jwt) throws Exception {
        return mvc.perform(get("/catalog/cafeterias/{id}/ofertas", cafeteriaId)
                .header("Authorization", "Bearer " + jwt));
    }

    private static void prohibido(ResultActions result) throws Exception {
        result.andExpect(status().isForbidden())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.status").value(403));
    }

    private static String jwt(UUID usuario, String role, UUID cafeteriaClaim) {
        JWTClaimsSet.Builder claims = claims().subject(usuario.toString()).claim("role", role);
        if (cafeteriaClaim != null) {
            claims.claim("cafeteriaId", cafeteriaClaim.toString());
        }
        return sign(claims.build(), KEYS, JWSAlgorithm.RS256);
    }
}
