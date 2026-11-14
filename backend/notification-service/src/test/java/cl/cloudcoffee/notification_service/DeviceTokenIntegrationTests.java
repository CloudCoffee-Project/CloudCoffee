package cl.cloudcoffee.notification_service;

import cl.cloudcoffee.security.testing.JwtTestSupport;
import com.nimbusds.jose.JWSAlgorithm;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "management.tracing.enabled=false",
        "spring.rabbitmq.listener.simple.auto-startup=false",
        "management.health.rabbit.enabled=false",
        "management.health.mail.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:notification-device-tokens;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password="
})
@AutoConfigureMockMvc
class DeviceTokenIntegrationTests extends JwtTestSupport {

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Test
    void registrationIsIdempotentAndUsesTheAuthenticatedSubject() throws Exception {
        UUID user = UUID.randomUUID();
        UUID suppliedUser = UUID.randomUUID();
        String token = "fcm-" + UUID.randomUUID();
        String body = "{\"token\":\"" + token + "\",\"plataforma\":\"android\",\"userId\":\""
                + suppliedUser + "\"}";

        register(user, "CLIENTE", body).andExpect(status().isNoContent());
        register(user, "CLIENTE", body).andExpect(status().isNoContent());

        assertThat(count(user)).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT user_id FROM notification_device_token WHERE token = ?", UUID.class, token))
                .isEqualTo(user);
        assertThat(jdbc.queryForObject(
                "SELECT token_type FROM notification_device_token WHERE token = ?", String.class, token))
                .isEqualTo("FCM");
    }

    @Test
    void multipleDevicesRotateIndependentlyAndDeleteIsIdempotent() throws Exception {
        UUID user = UUID.randomUUID();
        String oldToken = "fcm-old-" + UUID.randomUUID();
        String currentToken = "fcm-current-" + UUID.randomUUID();

        register(user, "CLIENTE", body(oldToken, "android", null)).andExpect(status().isNoContent());
        register(user, "CLIENTE", body(currentToken, "android", null)).andExpect(status().isNoContent());

        assertThat(count(user)).isEqualTo(2);
        eliminar(UUID.randomUUID(), "CLIENTE", body(oldToken, "android", null))
                .andExpect(status().isNoContent());
        assertThat(count(user)).isEqualTo(2);

        eliminar(user, "CLIENTE", body(oldToken, "android", null))
                .andExpect(status().isNoContent());
        eliminar(user, "CLIENTE", body(oldToken, "android", null))
                .andExpect(status().isNoContent());
        assertThat(count(user)).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM notification_device_token WHERE token = ?", Integer.class, currentToken))
                .isEqualTo(1);
    }

    @Test
    void registeringFromAnotherSessionTransfersOwnershipWithoutAllowingOldOwnerToDelete() throws Exception {
        UUID formerOwner = UUID.randomUUID();
        UUID currentOwner = UUID.randomUUID();
        String token = "fcm-transfer-" + UUID.randomUUID();
        String request = body(token, "android", null);

        register(formerOwner, "CLIENTE", request).andExpect(status().isNoContent());
        register(currentOwner, "CLIENTE", request).andExpect(status().isNoContent());
        eliminar(formerOwner, "CLIENTE", request).andExpect(status().isNoContent());

        assertThat(count(formerOwner)).isZero();
        assertThat(count(currentOwner)).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT user_id FROM notification_device_token WHERE token = ?", UUID.class, token))
                .isEqualTo(currentOwner);

        eliminar(currentOwner, "CLIENTE", request).andExpect(status().isNoContent());
        assertThat(count(currentOwner)).isZero();
    }

    @Test
    void storesApnsSeparatelyAndAllowsAnExplicitFcmTokenForIos() throws Exception {
        UUID user = UUID.randomUUID();
        String apnsToken = "a".repeat(64);
        String iosFcmToken = "ios-fcm-" + UUID.randomUUID();

        register(user, "CLIENTE", body(apnsToken, "ios", null)).andExpect(status().isNoContent());
        register(user, "CLIENTE", body(iosFcmToken, "ios", "FCM")).andExpect(status().isNoContent());

        assertThat(jdbc.queryForObject(
                "SELECT token_type FROM notification_device_token WHERE token = ?", String.class, apnsToken))
                .isEqualTo("APNS");
        assertThat(jdbc.queryForObject(
                "SELECT token_type FROM notification_device_token WHERE token = ?", String.class, iosFcmToken))
                .isEqualTo("FCM");
    }

    @Test
    void rejectsUnsupportedPlatformAndTokenTypeCombinations() throws Exception {
        UUID user = UUID.randomUUID();

        invalid(register(user, "CLIENTE", body("fcm-" + UUID.randomUUID(), "web", null)));
        invalid(register(user, "CLIENTE", body("fcm-" + UUID.randomUUID(), "android", "APNS")));
        invalid(register(user, "CLIENTE", body("not-an-apns-token", "ios", null)));
        invalid(register(user, "CLIENTE", body("bad token", "android", null)));
        assertThat(count(user)).isZero();
    }

    @Test
    void deviceRoutesAreAuthenticatedButOperationalHistoryRemainsSuperAdminOnly() throws Exception {
        UUID user = UUID.randomUUID();

        mvc.perform(post("/notifications/device-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("fcm-" + UUID.randomUUID(), "android", null)))
                .andExpect(status().isUnauthorized());
        mvc.perform(delete("/notifications/device-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("fcm-" + UUID.randomUUID(), "android", null)))
                .andExpect(status().isUnauthorized());
        invalid(register(user, "CLIENTE", "null"));
        mvc.perform(get("/notifications").header(HttpHeaders.AUTHORIZATION, bearer(user, "CLIENTE")))
                .andExpect(status().isForbidden());
        mvc.perform(get("/notifications").header(HttpHeaders.AUTHORIZATION,
                        bearer(UUID.randomUUID(), "SUPER_ADMIN")))
                .andExpect(status().isOk());
    }

    private ResultActions register(UUID user, String role, String body) throws Exception {
        return mvc.perform(post("/notifications/device-token")
                .header(HttpHeaders.AUTHORIZATION, bearer(user, role))
                .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private ResultActions eliminar(UUID user, String role, String body) throws Exception {
        return mvc.perform(delete("/notifications/device-token")
                .header(HttpHeaders.AUTHORIZATION, bearer(user, role))
                .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private static String body(String token, String platform, String tokenType) {
        return "{\"token\":\"" + token + "\",\"plataforma\":\"" + platform + "\""
                + (tokenType == null ? "" : ",\"tipoToken\":\"" + tokenType + "\"") + "}";
    }

    private int count(UUID user) {
        return jdbc.queryForObject(
                "SELECT COUNT(*) FROM notification_device_token WHERE user_id = ?", Integer.class, user);
    }

    private static void invalid(ResultActions request) throws Exception {
        request.andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
    }

    private static String bearer(UUID user, String role) {
        return "Bearer " + sign(claims().subject(user.toString()).claim("role", role).build(),
                KEYS, JWSAlgorithm.RS256);
    }
}
