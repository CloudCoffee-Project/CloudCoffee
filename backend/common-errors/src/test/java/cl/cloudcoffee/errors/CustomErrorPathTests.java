package cl.cloudcoffee.errors;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(classes = ApiErrorsIntegrationTests.TestApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "spring.web.error.path=/custom-error")
class CustomErrorPathTests {

    @Value("${local.server.port}") int port;
    @Autowired JsonMapper mapper;

    @Test
    void customBootErrorPathKeepsTheOriginalRequestInstance() throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            var response = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/send-error"))
                    .GET().build(), HttpResponse.BodyHandlers.ofString());
            assertThat(response.statusCode()).isEqualTo(418);
            var body = mapper.readTree(response.body());
            assertThat(body.get("instance").asText()).isEqualTo("/send-error");
            assertThat(body.get("status").asInt()).isEqualTo(418);
            assertThat(body.get("type").asText()).isEqualTo("about:blank");
            assertThat(body.get("timestamp").asText()).isNotBlank();
        }
    }
}
