package cl.cloudcoffee.catalog_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jwt.JWTClaimsSet;

import cl.cloudcoffee.catalog_service.dto.ReserveStockRequest;
import cl.cloudcoffee.catalog_service.messaging.StockEventPublisher;
import cl.cloudcoffee.catalog_service.service.StockReservationService;
import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.security.testing.JwtTestSupport;

@SpringBootTest(properties = {
        "management.tracing.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:catalog-admin;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password="
})
@AutoConfigureMockMvc
@ActiveProfiles("dev")
class CatalogAdministrationIntegrationTests extends JwtTestSupport {
    private static final String PRODUCTO_AMERICANO = "33333333-3333-4333-8333-333333333333";
    private static final String OFERTA_AMERICANO_CENTRAL = "55555555-5555-4555-8555-555555555501";
    private static final String CAMPUS = "11111111-1111-4111-8111-111111111111";

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired StockReservationService reservations;

    @MockitoBean
    StockEventPublisher stockEventPublisher;

    @Test
    void onlySuperAdminCanAccessMasterCatalogMaintenance() throws Exception {
        mvc.perform(get("/catalog/admin/categorias"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/catalog/admin/categorias").header("Authorization", bearer("CLIENTE")))
                .andExpect(status().isForbidden());
        mvc.perform(get("/catalog/admin/categorias").header("Authorization", bearer("SUPER_ADMIN")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isArray())
                .andExpect(jsonPath("$.pageable").doesNotExist());
        mvc.perform(get("/catalog/admin/productos").param("q", "  ")
                        .header("Authorization", bearer("SUPER_ADMIN")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void categoryCreationIsAuditedAndIdempotent() throws Exception {
        UUID key = UUID.randomUUID();
        String body = "{\"nombre\":\"Categoría única " + UUID.randomUUID() + "\",\"descripcion\":\"Bebidas\"}";
        var first = mvc.perform(post("/catalog/admin/categorias")
                        .header("Authorization", bearer("SUPER_ADMIN"))
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andExpect(header().exists("Location"))
                .andExpect(jsonPath("$.activa").value(true))
                .andExpect(jsonPath("$.version").value(1))
                .andReturn();

        var replay = mvc.perform(post("/catalog/admin/categorias")
                        .header("Authorization", bearer("SUPER_ADMIN"))
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andExpect(header().string("Idempotency-Replayed", "true"))
                .andReturn();
        assertThat(replay.getResponse().getContentAsString()).isEqualTo(first.getResponse().getContentAsString());
        assertThat(replay.getResponse().getHeader("Location")).isEqualTo(first.getResponse().getHeader("Location"));

        mvc.perform(post("/catalog/admin/categorias")
                        .header("Authorization", bearer("SUPER_ADMIN"))
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body.replace("Bebidas", "Otra descripción")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_CONFLICT"));

        mvc.perform(post("/catalog/admin/categorias")
                        .header("Authorization", bearer("SUPER_ADMIN"))
                        .header("Idempotency-Key", UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nombre\":\"" + body.split("\"")[3].toLowerCase() + "\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("NOMBRE_DUPLICADO"));

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM catalog_audit WHERE action = 'CREAR'",
                Integer.class)).isGreaterThanOrEqualTo(1);
    }

    @Test
    void categoryCannotBeDeactivatedWhileActiveProductsExistAndRelationsAreRetained() throws Exception {
        UUID categoryId = createCategory();
        UUID productId = createProduct(categoryId);

        mvc.perform(post("/catalog/admin/categorias/{id}/baja", categoryId)
                        .header("Authorization", bearer("SUPER_ADMIN")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CATEGORIA_EN_USO"));

        mvc.perform(post("/catalog/admin/productos/{id}/baja", productId)
                        .header("Authorization", bearer("SUPER_ADMIN")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.activo").value(false));
        mvc.perform(post("/catalog/admin/categorias/{id}/baja", categoryId)
                        .header("Authorization", bearer("SUPER_ADMIN")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.activa").value(false));

        assertThat(jdbc.queryForObject("SELECT category_id FROM product WHERE id = ?", UUID.class, productId))
                .isEqualTo(categoryId);
        mvc.perform(get("/catalog/categorias").header("Authorization", bearer("SUPER_ADMIN")))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.content()
                        .string(org.hamcrest.Matchers.not(containsString(categoryId.toString()))));
    }

    @Test
    void inactiveProductsDisappearFromPublicReadsAndCannotBeReserved() throws Exception {
        mvc.perform(post("/catalog/admin/productos/{id}/baja", PRODUCTO_AMERICANO)
                        .header("Authorization", bearer("SUPER_ADMIN")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.activo").value(false));
        try {
            mvc.perform(get("/catalog/productos/{id}", PRODUCTO_AMERICANO))
                    .andExpect(status().isNotFound());
            mvc.perform(get("/catalog/productos/{id}/ofertas", PRODUCTO_AMERICANO).param("campusId", CAMPUS))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$").isEmpty());
            mvc.perform(get("/catalog/productos").param("campusId", CAMPUS).param("q", "Café americano"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content").isEmpty());
            assertThatThrownBy(() -> reservations.reserve(new ReserveStockRequest(UUID.randomUUID(),
                    UUID.fromString(OFERTA_AMERICANO_CENTRAL), 1)))
                    .isInstanceOf(BusinessException.class);
        } finally {
            mvc.perform(post("/catalog/admin/productos/{id}/reactivar", PRODUCTO_AMERICANO)
                    .header("Authorization", bearer("SUPER_ADMIN")));
        }
    }

    @Test
    void editsRequireCurrentVersionAndProductFieldsAreMutable() throws Exception {
        UUID categoryId = createCategory();
        mvc.perform(post("/catalog/admin/productos")
                        .header("Authorization", bearer("SUPER_ADMIN"))
                        .header("Idempotency-Key", UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"categoriaId\":\"" + categoryId + "\",\"nombre\":\"Producto inválido\","
                                + "\"imagenUrl\":\"http://example.com/image.png\"}"))
                .andExpect(status().isBadRequest());
        UUID productId = createProduct(categoryId);
        mvc.perform(patch("/catalog/admin/productos/{id}", productId)
                        .header("Authorization", bearer("SUPER_ADMIN"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"descripcion\":\"Nueva descripción\",\"imagenUrl\":\"https://example.com/new.png\",\"version\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.descripcion").value("Nueva descripción"))
                .andExpect(jsonPath("$.imagenUrl").value("https://example.com/new.png"))
                .andExpect(jsonPath("$.version").value(2));
        mvc.perform(patch("/catalog/admin/productos/{id}", productId)
                        .header("Authorization", bearer("SUPER_ADMIN"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nombre\":\"Nombre desactualizado\",\"version\":1}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("VERSION_CONFLICTO"));
    }

    private UUID createCategory() throws Exception {
        String body = "{\"nombre\":\"Categoría " + UUID.randomUUID() + "\"}";
        String json = mvc.perform(post("/catalog/admin/categorias")
                        .header("Authorization", bearer("SUPER_ADMIN"))
                        .header("Idempotency-Key", UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return UUID.fromString(json.replaceAll("(?s).*\"categoriaId\":\"([^\"]+)\".*", "$1"));
    }

    private UUID createProduct(UUID categoryId) throws Exception {
        String body = "{\"categoriaId\":\"" + categoryId + "\",\"nombre\":\"Producto " + UUID.randomUUID() + "\"}";
        String json = mvc.perform(post("/catalog/admin/productos")
                        .header("Authorization", bearer("SUPER_ADMIN"))
                        .header("Idempotency-Key", UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return UUID.fromString(json.replaceAll("(?s).*\"productoId\":\"([^\"]+)\".*", "$1"));
    }

    private static String bearer(String role) {
        JWTClaimsSet claims = claims().claim("role", role).build();
        return "Bearer " + sign(claims, KEYS, JWSAlgorithm.RS256);
    }
}
