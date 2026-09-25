package cl.cloudcoffee.security.testing;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Ejecuta la misma matriz de seguridad contra la configuracion real de cada microservicio. */
@Import(ServiceJwtTests.IdentityController.class)
public abstract class ServiceJwtTests extends JwtTestSupport {
    @Autowired
    MockMvc securityMvc;

    @Test
    protected void directServiceAccessRequiresJwt() throws Exception {
        securityMvc.perform(get("/jwt-test/identity").header("X-User-Role", "SUPER_ADMIN"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.status").value(401))
                .andExpect(header().string(HttpHeaders.WWW_AUTHENTICATE, "Bearer"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"CLIENTE", "CAJERO", "ADMIN_CAFETERIA", "SUPER_ADMIN"})
    protected void validSignatureAuthenticatesSubjectAndRole(String role) throws Exception {
        String jwt = sign(claims().claim("role", role).build(), KEYS, com.nimbusds.jose.JWSAlgorithm.RS256);
        securityMvc.perform(get("/jwt-test/identity").header(HttpHeaders.AUTHORIZATION, "Bearer " + jwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.subject").value(SUBJECT))
                .andExpect(jsonPath("$.role").value("ROLE_" + role))
                .andExpect(header().doesNotExist(HttpHeaders.SET_COOKIE));
        // La autenticacion anterior no abre una sesion reutilizable.
        securityMvc.perform(get("/jwt-test/identity")).andExpect(status().isUnauthorized());
    }

    @ParameterizedTest
    @ValueSource(strings = {"malformed", "expired", "wrong-key", "wrong-algorithm", "missing-exp",
            "missing-sub", "missing-role", "invalid-role", "future", "tampered", "hmac"})
    protected void invalidJwtIsRejectedLocally(String kind) throws Exception {
        securityMvc.perform(get("/jwt-test/identity")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + invalidToken(kind)))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.status").value(401))
                .andExpect(jsonPath("$.instance").value("/jwt-test/identity"));
    }

    @RestController
    public static class IdentityController {
        @GetMapping("/jwt-test/identity")
        Map<String, String> identity(Authentication authentication) {
            return Map.of("subject", authentication.getName(), "role",
                    authentication.getAuthorities().stream()
                            .map(authority -> authority.getAuthority())
                            .filter(authority -> authority.startsWith("ROLE_"))
                            .findFirst().orElseThrow());
        }
    }
}
