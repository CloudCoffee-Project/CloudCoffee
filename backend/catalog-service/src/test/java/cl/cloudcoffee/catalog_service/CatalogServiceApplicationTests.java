package cl.cloudcoffee.catalog_service;

import cl.cloudcoffee.security.testing.ServiceJwtTests;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.http.HttpMethod;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class CatalogServiceApplicationTests extends ServiceJwtTests {

    @Autowired
    MockMvc mvc;

    @Test
    void authenticatedMissingRouteUsesSharedProblemDetails() throws Exception {
        mvc.perform(get("/missing-resource").header("Authorization", "Bearer " + token()))
                .andExpect(status().isNotFound())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.type").value("about:blank"))
                .andExpect(jsonPath("$.title").isNotEmpty())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.detail").isNotEmpty())
                .andExpect(jsonPath("$.instance").value("/missing-resource"))
                .andExpect(jsonPath("$.timestamp").isString());
    }

    @Test
    void serviceNamespaceRequiresAuthentication() throws Exception {
        mvc.perform(get("/catalog/productos"))
                .andExpect(status().isUnauthorized());
    }

    @ParameterizedTest
    @CsvSource({"GET, campus", "HEAD, campus", "GET, categorias", "HEAD, categorias"})
    void publicCatalogQueriesReachMvcWithoutJwt(String method, String endpoint) throws Exception {
        // Aun no hay controlador de catalogo: 404 prueba que seguridad deja pasar.
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request(
                        HttpMethod.valueOf(method), "/catalog/" + endpoint))
                .andExpect(status().isNotFound());
    }
}
