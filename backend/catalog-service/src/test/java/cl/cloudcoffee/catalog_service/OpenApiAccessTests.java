package cl.cloudcoffee.catalog_service;

import cl.cloudcoffee.security.testing.JwtTestSupport;
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
