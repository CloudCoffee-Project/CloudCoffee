package cl.cloudcoffee.catalog_service;

import cl.cloudcoffee.security.testing.JwtTestSupport;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"OPENAPI_ENABLED=true", "spring.rabbitmq.listener.simple.auto-startup=false",
        "management.health.rabbit.enabled=false", "management.tracing.enabled=false"})
@AutoConfigureMockMvc
class OpenApiAccessTests extends JwtTestSupport {
    @Autowired MockMvc mvc;
    @Autowired JsonMapper mapper;

    @Test
    void contractDescribesCatalogFiltersPaginationAndActualJwtRules() throws Exception {
        var api = mapper.readTree(mvc.perform(get("/v3/api-docs")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        assertThat(api.path("paths").size()).isEqualTo(4);
        assertThat(api.at("/servers/0/url").asText()).isEqualTo("/v1");
        assertThat(api.at("/paths/~1catalog~1campus/get/security").isMissingNode()).isTrue();
        assertThat(api.at("/paths/~1catalog~1categorias/get/security").isMissingNode()).isTrue();
        for (String path : new String[]{"/catalog/productos", "/catalog/productos/{id}/ofertas"}) {
            assertThat(api.path("paths").path(path).at("/get/security/0/bearerAuth").isArray()).isTrue();
            assertThat(api.path("paths").path(path).at("/get/responses/400/content/application~1problem+json/schema/$ref").asText())
                    .endsWith("/Problem");
        }
        var parameters = api.at("/paths/~1catalog~1productos/get/parameters");
        assertThat(parameters).hasSize(6);
        for (var parameter : parameters) {
            if (parameter.path("name").asText().equals("campusId")) {
                assertThat(parameter.path("required").asBoolean()).isTrue();
                assertThat(parameter.at("/schema/format").asText()).isEqualTo("uuid");
            }
            assertThat(parameter.path("description").asText()).isNotBlank();
        }
        assertThat(api.at("/paths/~1catalog~1productos~1{id}~1ofertas/get/responses/200/content/application~1json/schema/type").asText())
                .isEqualTo("array");
        assertThat(api.at("/components/schemas/ProductOfferResponse/properties/price/example").asDouble()).isEqualTo(1500.0);
        assertThat(api.at("/components/schemas/ProductOfferResponse/properties/disponible/type").asText()).isEqualTo("boolean");
        assertThat(api.at("/components/schemas/Problem/properties/timestamp/format").asText()).isEqualTo("date-time");
    }

    @Test
    void documentedPageRetainsExistingSerializationAndFilters() throws Exception {
        var api = mapper.readTree(mvc.perform(get("/v3/api-docs")).andReturn().getResponse().getContentAsString());
        var page = mapper.readTree(mvc.perform(get("/catalog/productos")
                        .header("Authorization", "Bearer " + token())
                        .param("campusId", "11111111-1111-4111-8111-111111111111")
                        .param("page", "0").param("size", "5").param("q", "café").param("sort", "name,asc"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(page.path("content")).isEmpty();
        assertThat(page.path("size").asInt()).isEqualTo(5);
        assertThat(page.path("number").asInt()).isZero();
        assertThat(page.path("totalElements").asInt()).isZero();
        assertThat(page.has("pageable")).isTrue();
        String ref = api.at("/paths/~1catalog~1productos/get/responses/200/content/application~1json/schema/$ref").asText();
        var properties = api.at(ref.substring(1)).path("properties");
        page.properties().forEach(entry -> assertThat(properties.has(entry.getKey())).as(entry.getKey()).isTrue());
        mvc.perform(get("/catalog/productos").header("Authorization", "Bearer " + token()))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.timestamp").isNotEmpty());
    }

    @Test
    void enabledContractIsReadableWithoutJwtAndDoesNotExposeInternalRoutes() throws Exception {
        mvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.openapi").isNotEmpty())
                .andExpect(jsonPath("$.paths['/internal/test/events/user-registered']").doesNotExist())
                .andExpect(jsonPath("$.paths['/actuator/health']").doesNotExist());
    }

    @Test
    void enablingDocumentationDoesNotMakeBusinessRoutesPublic() throws Exception {
        mvc.perform(get("/catalog/productos"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/v3/api-docs").header("Authorization", "Bearer malformed"))
                .andExpect(status().isUnauthorized());
    }
}
