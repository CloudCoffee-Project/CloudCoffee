package cl.cloudcoffee.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** Cliente de la consulta interna a auth-service, contra un servidor HTTP simulado. */
class HttpAsignacionesCafeteriaTests {

    static final String TOKEN = "token-interno-de-pruebas-0123456789abcdef";

    HttpServer auth;
    final AtomicReference<String> tokenRecibido = new AtomicReference<>();
    final AtomicReference<String> rutaRecibida = new AtomicReference<>();

    @AfterEach
    void detener() {
        if (auth != null) {
            auth.stop(0);
        }
    }

    @Test
    void devuelveLaCafeteriaYEnviaElTokenInterno() throws IOException {
        UUID usuario = UUID.randomUUID();
        UUID cafeteria = UUID.randomUUID();
        iniciar(200, "{\"usuarioId\":\"%s\",\"cafeteriaId\":\"%s\"}".formatted(usuario, cafeteria));

        assertThat(cliente(TOKEN).cafeteriaDe(usuario)).contains(cafeteria);
        assertThat(tokenRecibido.get()).isEqualTo(TOKEN);
        assertThat(rutaRecibida.get()).isEqualTo("/internal/servicios/asignaciones/" + usuario);
    }

    @Test
    void sinAsignacionDevuelveVacio() throws IOException {
        iniciar(404, "{\"status\":404}");

        assertThat(cliente(TOKEN).cafeteriaDe(UUID.randomUUID())).isEmpty();
    }

    @Test
    void erroresDeAuthNoSeConfundenConFaltaDeAsignacion() throws IOException {
        iniciar(500, "{}");
        assertThatThrownBy(() -> cliente(TOKEN).cafeteriaDe(UUID.randomUUID()))
                .isInstanceOf(AsignacionNoVerificableException.class);

        auth.stop(0);
        iniciar(401, "{}");
        assertThatThrownBy(() -> cliente(TOKEN).cafeteriaDe(UUID.randomUUID()))
                .isInstanceOf(AsignacionNoVerificableException.class);
    }

    @Test
    void authCaidoOTokenSinConfigurarFallanCerrado() {
        assertThatThrownBy(() -> new HttpAsignacionesCafeteria("http://127.0.0.1:1", TOKEN, Duration.ofSeconds(1))
                .cafeteriaDe(UUID.randomUUID()))
                .isInstanceOf(AsignacionNoVerificableException.class);
        assertThatThrownBy(() -> new HttpAsignacionesCafeteria("http://127.0.0.1:1", "", Duration.ofSeconds(1))
                .cafeteriaDe(UUID.randomUUID()))
                .isInstanceOf(AsignacionNoVerificableException.class);
    }

    private HttpAsignacionesCafeteria cliente(String token) {
        return new HttpAsignacionesCafeteria("http://127.0.0.1:" + auth.getAddress().getPort(), token,
                Duration.ofSeconds(2));
    }

    private void iniciar(int status, String body) throws IOException {
        auth = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        auth.createContext("/", exchange -> {
            try (exchange) {
                tokenRecibido.set(exchange.getRequestHeaders().getFirst(InternalServiceAuthenticationFilter.HEADER));
                rutaRecibida.set(exchange.getRequestURI().getPath());
                byte[] respuesta = body.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(status, respuesta.length);
                exchange.getResponseBody().write(respuesta);
            }
        });
        auth.start();
    }
}
