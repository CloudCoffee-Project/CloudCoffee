package cl.cloudcoffee.notification_service;

import cl.cloudcoffee.security.testing.ServiceJwtTests;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"spring.rabbitmq.listener.simple.auto-startup=false",
        "management.health.rabbit.enabled=false"})
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

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({"GET, health", "HEAD, health", "GET, info", "HEAD, info"})
    void existingMonitoringEndpointsRemainPublic(String method, String endpoint) throws Exception {
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request(
                        org.springframework.http.HttpMethod.valueOf(method), "/actuator/" + endpoint))
                .andExpect(status().isOk());
    }
}
