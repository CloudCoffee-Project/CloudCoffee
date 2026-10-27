package cl.cloudcoffee.notification_service;

import cl.cloudcoffee.security.testing.ServiceJwtTests;
import cl.cloudcoffee.security.testing.JwtTestSupport;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"spring.rabbitmq.listener.simple.auto-startup=false",
        "management.health.rabbit.enabled=false",
        "management.health.mail.enabled=false"})
@AutoConfigureMockMvc
class NotificationServiceApplicationTests extends ServiceJwtTests {

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
        mvc.perform(get("/notifications"))
                .andExpect(status().isUnauthorized());
    }

    @ParameterizedTest
    @ValueSource(strings = {"CLIENTE", "CAJERO", "ADMIN_CAFETERIA"})
    void notificationHistoryRejectsNonSuperAdminRoles(String role) throws Exception {
        mvc.perform(get("/notifications?page=0&size=5")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + JwtTestSupport.sign(
                                JwtTestSupport.claims().claim("role", role).build(),
                                JwtTestSupport.KEYS, com.nimbusds.jose.JWSAlgorithm.RS256)))
                .andExpect(status().isForbidden());
    }

    @Test
    void superAdminCanReadPaginatedNotificationHistory() throws Exception {
        String token = JwtTestSupport.sign(
                JwtTestSupport.claims().claim("role", "SUPER_ADMIN").build(),
                JwtTestSupport.KEYS, com.nimbusds.jose.JWSAlgorithm.RS256);

        mvc.perform(get("/notifications?page=0&size=5")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(5))
                .andExpect(jsonPath("$.number").value(0));
    }
}
