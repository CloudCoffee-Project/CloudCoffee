package cl.cloudcoffee.errors;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;

import cl.cloudcoffee.errors.security.ApiSecurityErrorHandler;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.web.ErrorResponseException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(classes = ApiErrorsIntegrationTests.TestApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
class ApiErrorsIntegrationTests {

    @Autowired MockMvc mvc;
    @Autowired JsonMapper mapper;
    @Value("${local.server.port}") int port;

    @Test
    void missingRouteUsesProblemDetailsEvenForHtmlClients() throws Exception {
        contract(mvc.perform(get("/missing?token=private").accept(MediaType.TEXT_HTML)), 404, "/missing")
                .andExpect(content().string(not(containsString("private"))));
    }

    @Test
    void invalidBodyListsFieldsWithoutRejectedValues() throws Exception {
        contract(mvc.perform(post("/validate").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"private-invalid-value\"}")), 400, "/validate")
                .andExpect(jsonPath("$.errors[0].field").value("email"))
                .andExpect(jsonPath("$.errors[0].message").value("El correo debe ser válido."))
                .andExpect(content().string(not(containsString("private-invalid-value"))));
    }

    @Test
    void malformedJsonUsesCommonContract() throws Exception {
        contract(mvc.perform(post("/validate").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":")), 400, "/validate");
    }

    @Test
    void missingBodyUsesCommonContract() throws Exception {
        contract(mvc.perform(post("/validate").with(csrf()).contentType(MediaType.APPLICATION_JSON)),
                400, "/validate");
    }

    @Test
    void invalidRequestParameterUsesCommonContract() throws Exception {
        contract(mvc.perform(get("/quantity").param("value", "0")), 400, "/quantity");
    }

    @Test
    void parameterConversionFailureUsesCommonContract() throws Exception {
        contract(mvc.perform(get("/quantity").param("value", "not-a-number")), 400, "/quantity");
    }

    @Test
    void invalidReturnValueIsInternalError() throws Exception {
        contract(mvc.perform(get("/invalid-return")), 500, "/invalid-return")
                .andExpect(jsonPath("$.detail").value(ApiProblems.defaultDetail(HttpStatus.INTERNAL_SERVER_ERROR)));
    }

    @Test
    void methodNotAllowedPreservesAllowHeader() throws Exception {
        contract(mvc.perform(post("/quantity").with(csrf())), 405, "/quantity")
                .andExpect(header().string(HttpHeaders.ALLOW, containsString("GET")));
    }

    @Test
    void unsupportedContentTypeUsesCommonContract() throws Exception {
        contract(mvc.perform(post("/validate").with(csrf()).contentType(MediaType.TEXT_PLAIN)
                .content("hello")), 415, "/validate");
    }

    @Test
    void businessErrorKeepsItsPublicTypeAndMessage() throws Exception {
        contract(mvc.perform(get("/business")), 409, "/business")
                .andExpect(jsonPath("$.type").value("/problems/out-of-stock"))
                .andExpect(jsonPath("$.title").value("Stock insuficiente"))
                .andExpect(jsonPath("$.detail").value("No hay unidades disponibles del producto."));
    }

    @Test
    void missingDomainResourceUsesCommonContract() throws Exception {
        contract(mvc.perform(get("/resource")), 404, "/resource");
    }

    @Test
    void unexpectedFailureDoesNotExposeException() throws Exception {
        contract(mvc.perform(get("/unexpected")), 500, "/unexpected")
                .andExpect(content().string(not(containsString("secret-database-password"))))
                .andExpect(jsonPath("$.trace").doesNotExist());
    }

    @Test
    void frameworkErrorPreservesRetryAfterHeader() throws Exception {
        contract(mvc.perform(get("/limited")), 429, "/limited")
                .andExpect(header().string(HttpHeaders.RETRY_AFTER, "60"));
    }

    @Test
    void unauthenticatedFilterRequestUsesCommonContractAndChallenge() throws Exception {
        contract(mvc.perform(get("/secure")), 401, "/secure")
                .andExpect(header().string(HttpHeaders.WWW_AUTHENTICATE, "Bearer"));
    }

    @Test
    @WithMockUser(roles = "USER")
    void authenticatedUserWithoutPermissionGets403FromSecurityFilter() throws Exception {
        contract(mvc.perform(get("/secure")), 403, "/secure");
    }

    @Test
    @WithMockUser(roles = "ADMIN")
    void successfulRequestRemainsUnchanged() throws Exception {
        mvc.perform(get("/secure")).andExpect(status().isOk()).andExpect(content().string("ok"));
    }

    @Test
    void controllerAuthenticationFailureDoesNotExposeCredentials() throws Exception {
        contract(mvc.perform(get("/authentication-failure")), 401, "/authentication-failure")
                .andExpect(content().string(not(containsString("secret-credentials"))));
    }

    @Test
    void controllerAuthorizationFailureUsesCommonContract() throws Exception {
        contract(mvc.perform(get("/authorization-failure")), 403, "/authorization-failure");
    }

    @Test
    void authenticationFailureHandlerWritesSameContract() throws Exception {
        contract(mvc.perform(get("/login-filter-failure")), 401, "/login-filter-failure");
    }

    @Test
    void sendErrorIsRenderedByRealContainerWithOriginalPath() throws Exception {
        realHttpContract("/send-error?token=private", 418, "/send-error");
    }

    @Test
    void unhandledFilterFailureIsRenderedByRealContainer() throws Exception {
        realHttpContract("/filter-failure", 500, "/filter-failure");
    }

    @Test
    void nonStandardErrorStatusStillIncludesAllFields() throws Exception {
        realHttpContract("/custom-status", 499, "/custom-status");
    }

    private ResultActions contract(ResultActions result, int statusCode, String path) throws Exception {
        result.andExpect(status().is(statusCode))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.type").isString())
                .andExpect(jsonPath("$.title").isNotEmpty())
                .andExpect(jsonPath("$.status").value(statusCode))
                .andExpect(jsonPath("$.detail").isNotEmpty())
                .andExpect(jsonPath("$.instance").value(path));
        var body = mapper.readTree(result.andReturn().getResponse().getContentAsString());
        assertThat(Instant.parse(body.get("timestamp").asText())).isBeforeOrEqualTo(Instant.now());
        return result;
    }

    private void realHttpContract(String path, int statusCode, String instance) throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            var response = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                    .header("Accept", "text/html").GET().build(), HttpResponse.BodyHandlers.ofString());
            assertThat(response.statusCode()).isEqualTo(statusCode);
            assertThat(response.headers().firstValue("Content-Type").orElseThrow())
                    .startsWith(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
            var body = mapper.readTree(response.body());
            assertThat(body.get("status").asInt()).isEqualTo(statusCode);
            assertThat(body.get("instance").asText()).isEqualTo(instance);
            assertThat(body.get("type").asText()).isEqualTo("about:blank");
            assertThat(body.get("title").asText()).isNotBlank();
            assertThat(body.get("detail").asText()).isNotBlank();
            assertThat(Instant.parse(body.get("timestamp").asText())).isBeforeOrEqualTo(Instant.now());
            assertThat(response.body()).doesNotContain("private", "secret", "trace");
        }
    }

    @SpringBootConfiguration
    @EnableAutoConfiguration
    @Import(FixtureController.class)
    static class TestApplication {

        @Bean
        SecurityFilterChain testSecurity(HttpSecurity http, ApiSecurityErrorHandler errors) throws Exception {
            return http.authorizeHttpRequests(auth -> auth
                            .requestMatchers("/secure").hasRole("ADMIN").anyRequest().permitAll())
                    .exceptionHandling(exceptions -> exceptions
                            .authenticationEntryPoint(errors).accessDeniedHandler(errors))
                    .build();
        }

        @Bean
        OncePerRequestFilter failingFilter(ApiSecurityErrorHandler errors) {
            return new OncePerRequestFilter() {
                @Override
                protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                        FilterChain chain) throws ServletException, IOException {
                    if (request.getRequestURI().equals("/filter-failure")) {
                        throw new IllegalStateException("secret-filter-detail");
                    }
                    if (request.getRequestURI().equals("/login-filter-failure")) {
                        errors.onAuthenticationFailure(request, response,
                                new BadCredentialsException("secret-credentials"));
                        return;
                    }
                    chain.doFilter(request, response);
                }
            };
        }
    }

    @RestController
    static class FixtureController {
        @PostMapping("/validate")
        void validate(@Valid @RequestBody Input input) {
        }

        @GetMapping("/quantity")
        int quantity(@RequestParam @Min(1) int value) {
            return value;
        }

        @GetMapping("/invalid-return")
        @NotNull
        String invalidReturn() {
            return null;
        }

        @GetMapping("/business")
        void business() {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/out-of-stock"),
                    "Stock insuficiente", "No hay unidades disponibles del producto.");
        }

        @GetMapping("/resource")
        void resource() {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "El producto no existe.");
        }

        @GetMapping("/unexpected")
        void unexpected() {
            throw new IllegalStateException("secret-database-password");
        }

        @GetMapping("/limited")
        void limited() {
            var error = new ErrorResponseException(HttpStatus.TOO_MANY_REQUESTS,
                    ProblemDetail.forStatus(HttpStatus.TOO_MANY_REQUESTS), null);
            error.getHeaders().set(HttpHeaders.RETRY_AFTER, "60");
            throw error;
        }

        @GetMapping("/secure")
        String secure() {
            return "ok";
        }

        @GetMapping("/authentication-failure")
        void authenticationFailure() {
            throw new BadCredentialsException("secret-credentials");
        }

        @GetMapping("/authorization-failure")
        void authorizationFailure() {
            throw new AccessDeniedException("secret-permissions");
        }

        @GetMapping("/send-error")
        void sendError(HttpServletResponse response) throws IOException {
            response.sendError(418, "secret-container-detail");
        }

        @GetMapping("/custom-status")
        void customStatus(HttpServletResponse response) throws IOException {
            response.sendError(499);
        }
    }

    record Input(@NotBlank @Email(message = "El correo debe ser válido.") String email) {
    }
}
