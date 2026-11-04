package cl.cloudcoffee.notification_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

/** Guards the deployment wiring that is absent from ordinary application-context tests. */
class NotificationComposeConfigurationTests {

    @Test
    void notificationCanReachAuthUsingTheSameRequiredInternalSecret() throws IOException {
        Path root = Path.of("").toAbsolutePath();
        while (root != null && !Files.isRegularFile(root.resolve("docker-compose.yml"))) {
            root = root.getParent();
        }
        assertThat(root).as("repository root with docker-compose.yml").isNotNull();
        try (var input = Files.newInputStream(root.resolve("docker-compose.yml"))) {
            Map<?, ?> compose = new Yaml().load(input);
            Map<?, ?> services = (Map<?, ?>) compose.get("services");
            Map<?, ?> notification = (Map<?, ?>) services.get("notification-service");
            Map<?, ?> environment = (Map<?, ?>) notification.get("environment");
            Map<?, ?> authEnvironment = (Map<?, ?>) ((Map<?, ?>) services.get("auth-service")).get("environment");

            assertThat(environment.get("AUTH_SERVICE_URL")).isEqualTo("http://auth-service:8081");
            assertThat(environment.get("INTERNAL_SERVICE_TOKEN"))
                    .isEqualTo(authEnvironment.get("INTERNAL_SERVICE_TOKEN"))
                    .asString().startsWith("${INTERNAL_SERVICE_TOKEN:?");
            Map<?, ?> dependencies = (Map<?, ?>) notification.get("depends_on");
            assertThat(((Map<?, ?>) dependencies.get("auth-service")).get("condition"))
                    .isEqualTo("service_healthy");
        }
    }
}
