package cl.cloudcoffee.auth_service;

import cl.cloudcoffee.security.testing.JwtTestSupport;
import cl.cloudcoffee.auth_service.service.PerfilService;
import cl.cloudcoffee.auth_service.dto.PerfilResponse;
import cl.cloudcoffee.auth_service.model.Rol;
import java.util.UUID;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import static org.mockito.Mockito.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import org.springframework.http.MediaType;
import tools.jackson.databind.json.JsonMapper;
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
    @MockitoBean PerfilService perfilService;
    @DynamicPropertySource
    static void privateKey(DynamicPropertyRegistry registry) {
        registry.add("JWT_PRIVATE_KEY_LOCATION", () -> PRIVATE_KEY_LOCATION);
    }

    @Test
    void contractMatchesImplementedAuthOperationsAndSecurity() throws Exception {
        var api = mapper.readTree(mvc.perform(get("/v3/api-docs")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        assertThat(api.path("paths").size()).isEqualTo(10); // /users/me contiene GET y PATCH.
        assertThat(api.at("/servers/0/url").asText()).isEqualTo("/v1");
        assertThat(api.at("/paths/~1auth~1login/post/responses/200/content/application~1json/schema/$ref").asText())
                .endsWith("/LoginResponse");
        assertThat(api.at("/paths/~1auth~1login/post/security").isMissingNode()).isTrue();
        for (String path : new String[]{"/auth/logout", "/auth/users/me", "/auth/users/me/password"}) {
            var item = api.path("paths").path(path);
            item.properties().forEach(entry -> assertThat(entry.getValue().at("/security/0/bearerAuth").isArray()).isTrue());
        }
        assertThat(api.path("paths").has("/v1/auth/users/me")).isFalse();
        assertThat(api.at("/paths/~1auth~1password~1reset/post/responses/204/content").isMissingNode()).isTrue();
        assertThat(api.at("/paths/~1auth~1password~1recovery/post/responses/202/content").isMissingNode()).isTrue();
        assertThat(api.at("/paths/~1auth~1logout/post/parameters").toString()).doesNotContain("jwt");
        for (String path : new String[]{"/auth/login", "/auth/password/recovery", "/auth/verificacion/reenviar"}) {
            assertThat(api.path("paths").path(path).at("/post/responses/429/headers/Retry-After/schema/type").asText())
                    .isEqualTo("integer");
        }
        assertThat(api.at("/paths/~1auth~1register/post/responses/409/content/application~1problem+json/schema/$ref").asText())
                .endsWith("/Problem");
        assertThat(api.at("/components/schemas/Problem/properties/timestamp/format").asText()).isEqualTo("date-time");
        assertThat(api.at("/components/schemas/Problem/properties/errors/items/properties/field/type").asText()).isEqualTo("string");
        assertThat(api.at("/components/schemas/RegistroClienteRequest/properties/password/minLength").asInt()).isEqualTo(8);
        assertThat(api.at("/components/schemas/ChangePasswordRequest/properties/passwordNueva/minLength").asInt()).isEqualTo(6);
        assertThat(api.at("/components/schemas/LoginRequest/properties/email/example").asText()).isEqualTo("cliente@example.com");
    }

    @Test
    void profileMappingAcceptsThePathForwardedByGatewayAndUsesJwtSubject() throws Exception {
        var profile = new PerfilResponse(UUID.fromString(SUBJECT), "cliente@example.com", "Ana", "Ejemplo", "+56912345678", Rol.CLIENTE);
        when(perfilService.obtenerPerfilUsuario(SUBJECT)).thenReturn(profile);
        when(perfilService.actualizarPerfilUsuario(eq(SUBJECT), any())).thenReturn(profile);
        mvc.perform(get("/auth/users/me").header("Authorization", "Bearer " + token()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(SUBJECT));
        mvc.perform(patch("/auth/users/me").header("Authorization", "Bearer " + token())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"nombre\":\"Ana\"}"))
                .andExpect(status().isOk());
        mvc.perform(patch("/auth/users/me/password").header("Authorization", "Bearer " + token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"passwordActual\":\"CafeDemo123!\",\"passwordNueva\":\"NuevaDemo123!\"}"))
                .andExpect(status().isOk()).andExpect(content().string(""));
        verify(perfilService).obtenerPerfilUsuario(SUBJECT);
        verify(perfilService).actualizarPerfilUsuario(eq(SUBJECT), any());
        verify(perfilService).cambiarPassword(eq(SUBJECT), any());
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
        mvc.perform(get("/auth/users/me"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/v3/api-docs").header("Authorization", "Bearer malformed"))
                .andExpect(status().isUnauthorized());
    }
}
