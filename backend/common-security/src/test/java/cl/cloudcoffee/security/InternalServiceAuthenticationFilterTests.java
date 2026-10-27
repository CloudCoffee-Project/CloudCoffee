package cl.cloudcoffee.security;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

class InternalServiceAuthenticationFilterTests {

    static final String TOKEN = "token-interno-de-pruebas-0123456789abcdef";

    @AfterEach
    void limpiar() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void autenticaComoServicioConElTokenCorrecto() throws Exception {
        filtrar(new InternalServiceAuthenticationFilter(TOKEN), "/internal/servicios/asignaciones/1", TOKEN);

        var autenticacion = SecurityContextHolder.getContext().getAuthentication();
        assertThat(autenticacion).isNotNull();
        assertThat(autenticacion.getAuthorities()).extracting(Object::toString).containsExactly("ROLE_INTERNAL_SERVICE");
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"corto", "token-interno-de-pruebas-0123456789abcdeX"})
    void tokenAusenteOIncorrectoNoAutentica(String recibido) throws Exception {
        filtrar(new InternalServiceAuthenticationFilter(TOKEN), "/internal/servicios/asignaciones/1", recibido);

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"token-de-menos-de-32-caracteres"})
    void sinTokenConfiguradoOMuyCortoFallaCerrado(String configurado) throws Exception {
        filtrar(new InternalServiceAuthenticationFilter(configurado), "/internal/servicios/asignaciones/1", configurado);

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @Test
    void noActuaFueraDeLasRutasInternasDeServicio() throws Exception {
        filtrar(new InternalServiceAuthenticationFilter(TOKEN), "/catalog/productos", TOKEN);
        filtrar(new InternalServiceAuthenticationFilter(TOKEN), "/internal/test/events/user-registered", TOKEN);

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    private static void filtrar(InternalServiceAuthenticationFilter filtro, String ruta, String token) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", ruta);
        if (token != null) {
            request.addHeader(InternalServiceAuthenticationFilter.HEADER, token);
        }
        filtro.doFilter(request, new MockHttpServletResponse(), new MockFilterChain());
    }
}
